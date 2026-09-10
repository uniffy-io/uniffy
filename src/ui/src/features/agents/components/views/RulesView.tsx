import { Fragment, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ListChecks, Plus, PushPin } from "@phosphor-icons/react";
import { RuleSource, RuleStatus } from "@uniffy/proto/agents/v1/rules_pb";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BrowseBody,
  BrowseCard,
  BrowseEmpty,
  BrowseGrid,
  BrowseGroupLabel,
  BrowseHeader,
  BrowsePaneMessage,
  BrowsePaneSpinner,
} from "@/features/agents/components/browse/BrowseSurface";
import { RuleDetail } from "@/features/agents/components/views/RuleDetail";
import {
  fetchRule,
  fetchRules,
  type SerializedRule,
} from "@/features/agents/store/agentRulesThunks";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";

export function RulesView() {
  const dispatch = useAppDispatch();
  const { subId } = useParams<{ subId?: string }>();
  useDocumentTitle("Rules");

  useEffect(() => {
    dispatch(fetchRules());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!subId) return <RulesBrowse />;
  if (subId === "new") return <RuleDetail />;
  return <RulePane ruleId={subId} />;
}

const RULE_GROUPS = [
  { source: RuleSource.ORGANIZATION, label: "Organization" },
  { source: RuleSource.BUNDLED, label: "Bundled" },
] as const;

function RuleCard({ rule, onOpen }: { rule: SerializedRule; onOpen: () => void }) {
  const retired = rule.status === RuleStatus.RETIRED;
  return (
    <BrowseCard
      onOpen={onOpen}
      testId={`rules-card-${rule.id}`}
      dimmed={retired}
      leading={
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ListChecks size={18} weight="duotone" />
        </span>
      }
      title={rule.displayName || rule.name}
      subtitle={rule.description || "No description"}
      badges={
        retired ? (
          <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">
            retired
          </Badge>
        ) : undefined
      }
      chips={
        <>
          <Badge variant="secondary" className="font-mono text-[10px] font-medium">
            {rule.name}
          </Badge>
          <Badge variant="secondary" className="gap-1 text-[10px] font-medium">
            {rule.activeVersionPinned && <PushPin size={10} weight="fill" />}
            {`v${rule.latestVersionNumber || 1}`}
          </Badge>
        </>
      }
    />
  );
}

function RulesBrowse() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const rulesMap = useAppSelector((s) => s.agentRules.rules);
  const loading = useAppSelector((s) => s.agentRules.loading);
  const nextPageToken = useAppSelector((s) => s.agentRules.nextPageToken);
  const [search, setSearch] = useState("");

  const query = search.trim().toLowerCase();
  const rules = Object.values(rulesMap).filter((rule) => {
    if (!query) return true;
    return `${rule.displayName} ${rule.name} ${rule.description}`.toLowerCase().includes(query);
  });

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="rules-browse">
      <BrowseHeader
        icon={ListChecks}
        title="Rules"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search rules..."
        testId="rules-browse-header"
        action={
          <Button onClick={() => navigate("/agents/rules/new")} data-testid="rules-new-rule">
            <Plus size={16} />
            New rule
          </Button>
        }
      />
      <BrowseBody testId="rules-browse-body">
        {rules.length === 0 ? (
          <BrowseEmpty
            icon={ListChecks}
            title={query ? "No match" : loading ? "Loading rules..." : "No rules yet"}
            description={
              query
                ? `No rule matches "${search.trim()}".`
                : "Choose rules for each agent in its Capabilities panel. Selected rules are appended to that agent’s runs."
            }
            testId="rules-browse-empty"
          />
        ) : (
          RULE_GROUPS.map(({ source, label }) => {
            const group = rules.filter((rule) => rule.source === source);
            if (group.length === 0) return null;
            return (
              <Fragment key={source}>
                <BrowseGroupLabel>{label}</BrowseGroupLabel>
                <BrowseGrid>
                  {group.map((rule) => (
                    <RuleCard
                      key={rule.id}
                      rule={rule}
                      onOpen={() => navigate(`/agents/rules/${rule.id}`)}
                    />
                  ))}
                </BrowseGrid>
              </Fragment>
            );
          })
        )}
        {nextPageToken && (
          <Button
            className="mt-6"
            variant="outline"
            disabled={loading}
            onClick={() => dispatch(fetchRules(nextPageToken))}
          >
            Load more
          </Button>
        )}
      </BrowseBody>
    </div>
  );
}

function RulePane({ ruleId }: { ruleId: string }) {
  const dispatch = useAppDispatch();
  const rule = useAppSelector((s) => s.agentRules.details[ruleId]);
  const status = useAppSelector((s) => s.agentRules.detailStatus[ruleId]);

  // The list omits rule bodies, so the detail always reads the full row.
  useEffect(() => {
    dispatch(fetchRule(ruleId));
  }, [dispatch, ruleId]);

  if (rule) return <RuleDetail rule={rule} />;
  if (status === "failed") {
    return (
      <BrowsePaneMessage
        icon={ListChecks}
        title="Rule not found"
        description="This rule no longer exists or you do not have access to it."
      />
    );
  }
  return <BrowsePaneSpinner />;
}
