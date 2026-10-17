import * as Y from "yjs";
import { digest } from "lib0/hash/sha256";
import { toHexString } from "lib0/buffer";
import type { Node } from "@milkdown/prose/model";
import type { FragmentSeeder } from "@/features/realtime/multiplexer";
import {
  fragmentHasRealContent,
  getProsemirrorFragment,
  MARKDOWN_MIRROR_FIELD,
  replaceProsemirrorFragment,
} from "@/features/realtime/markdown";
import { HYDRATION_ORIGIN } from "@/features/realtime/persistence/encryptedYjsPersistence";

export const SEEDED_BY_KEY = "seeded_by";
const SEED_CLAIM_PREFIX = "seeded_by:";
const SEED_CONTENT_PREFIX = "seed_content:";
const seedHash = (text: string) => `sha256:${toHexString(digest(new TextEncoder().encode(text)))}`;

export function seedProsemirrorFragment(ydoc: Y.Doc, node: Node): void {
  const fragment = getProsemirrorFragment(ydoc);
  const metadata = ydoc.getMap(MARKDOWN_MIRROR_FIELD);
  ydoc.transact(() => {
    replaceProsemirrorFragment(ydoc, node, HYDRATION_ORIGIN);
    metadata.set(SEEDED_BY_KEY, ydoc.clientID);
    // Concurrent scalar values favor the higher client ID. Independent claims
    // keep the lower seed visible and bound cleanup to its original blocks.
    metadata.set(
      `${SEED_CLAIM_PREFIX}${ydoc.clientID}`,
      fragment.toArray().map((item) => item._item!.id.clock),
    );
    metadata.set(
      `${SEED_CONTENT_PREFIX}${ydoc.clientID}`,
      fragment.toArray().map((item) => seedHash(item.toString())),
    );
  }, HYDRATION_ORIGIN);
}

export function observeFragmentSeedDuplicates(ydoc: Y.Doc): () => void {
  const fragment = getProsemirrorFragment(ydoc);
  const metadata = ydoc.getMap(MARKDOWN_MIRROR_FIELD);
  let reconciling = false;
  const reconcile = () => {
    if (reconciling) return;
    const ownClocks = metadata.get(`${SEED_CLAIM_PREFIX}${ydoc.clientID}`);
    const ownContent = metadata.get(`${SEED_CONTENT_PREFIX}${ydoc.clientID}`);
    if (!Array.isArray(ownClocks) || !Array.isArray(ownContent)) return;
    const items = fragment.toArray();
    let winner = metadata.get(SEEDED_BY_KEY);
    for (const [key, clocks] of metadata.entries()) {
      if (!key.startsWith(SEED_CLAIM_PREFIX) || !Array.isArray(clocks)) continue;
      const clientId = Number(key.slice(SEED_CLAIM_PREFIX.length));
      if (
        !items.some(
          (item) => item._item?.id.client === clientId && clocks.includes(item._item.id.clock),
        )
      )
        continue;
      if (typeof winner !== "number" || clientId < winner) winner = clientId;
    }
    if (typeof winner !== "number" || winner >= ydoc.clientID) return;
    reconciling = true;
    try {
      ydoc.transact(() => {
        for (let index = items.length - 1; index >= 0; index--) {
          const id = items[index]._item?.id;
          // Edits inside a seed block belong to users even when its seed loses arbitration.
          if (
            id?.client === ydoc.clientID &&
            ownClocks.includes(id.clock) &&
            (seedHash(items[index].toString()) === ownContent[ownClocks.indexOf(id.clock)] ||
              items[index].toString() === ownContent[ownClocks.indexOf(id.clock)])
          )
            fragment.delete(index, 1);
        }
        if (metadata.get(SEEDED_BY_KEY) !== winner) metadata.set(SEEDED_BY_KEY, winner);
      }, HYDRATION_ORIGIN);
    } finally {
      reconciling = false;
    }
  };
  fragment.observeDeep(reconcile);
  metadata.observe(reconcile);
  reconcile();
  return () => {
    fragment.unobserveDeep(reconcile);
    metadata.unobserve(reconcile);
  };
}

export function waitForFragmentSeed(
  fragment: Y.XmlFragment,
  seeder: Pick<FragmentSeeder, "isFragmentSeeder" | "subscribeFragmentSeeder">,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted || seeder.isFragmentSeeder || fragmentHasRealContent(fragment))
    return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      unsubscribe();
      fragment.unobserveDeep(onChange);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const onChange = () => {
      if (seeder.isFragmentSeeder || fragmentHasRealContent(fragment)) finish();
    };
    const unsubscribe = seeder.subscribeFragmentSeeder(onChange);
    fragment.observeDeep(onChange);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

export async function initializeFragment(
  ydoc: Y.Doc,
  seeder: FragmentSeeder,
  parse: (markdown: string) => Node | null | undefined,
  signal: AbortSignal,
): Promise<void> {
  seeder.setSeedCapability?.(true);
  signal.addEventListener("abort", () => seeder.setSeedCapability?.(false), { once: true });
  const fragment = getProsemirrorFragment(ydoc);
  while (!signal.aborted && !fragmentHasRealContent(fragment)) {
    const base = ydoc.getText("markdown").toString();
    if (!base) return;
    await waitForFragmentSeed(fragment, seeder, signal);
    if (signal.aborted || fragmentHasRealContent(fragment)) return;
    const current = ydoc.getText("markdown").toString();
    if (!current) return;
    const node = parse(current);
    if (!node) throw new Error("Document could not be parsed");
    // No speculative seed reaches the editable document or its recovery rows.
    const proposal = new Y.Doc();
    try {
      Y.applyUpdate(proposal, Y.encodeStateAsUpdate(ydoc));
      const vector = Y.encodeStateVector(proposal);
      seedProsemirrorFragment(proposal, node);
      const accepted = await seeder.submitSeed(
        Y.encodeStateAsUpdate(proposal, vector),
        current,
        signal,
      );
      if (accepted) return;
    } finally {
      proposal.destroy();
    }
    if (!signal.aborted && !fragmentHasRealContent(fragment)) {
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, 1000);
        signal.addEventListener("abort", finish, { once: true });
      });
    }
  }
}
