import * as Y from "yjs";
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
  }, HYDRATION_ORIGIN);
}

export function observeFragmentSeedDuplicates(ydoc: Y.Doc): () => void {
  const fragment = getProsemirrorFragment(ydoc);
  const metadata = ydoc.getMap(MARKDOWN_MIRROR_FIELD);
  let reconciling = false;
  const reconcile = () => {
    if (reconciling) return;
    const ownClocks = metadata.get(`${SEED_CLAIM_PREFIX}${ydoc.clientID}`);
    if (!Array.isArray(ownClocks)) return;
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
          if (id?.client === ydoc.clientID && ownClocks.includes(id.clock))
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
  seeder: FragmentSeeder,
  timeoutMs: number,
): Promise<void> {
  if (seeder.isFragmentSeeder || fragmentHasRealContent(fragment)) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      unsubscribe();
      fragment.unobserveDeep(onChange);
      resolve();
    };
    const onChange = () => {
      if (seeder.isFragmentSeeder || fragmentHasRealContent(fragment)) finish();
    };
    const unsubscribe = seeder.subscribeFragmentSeeder(onChange);
    fragment.observeDeep(onChange);
    const timer = setTimeout(finish, timeoutMs);
  });
}
