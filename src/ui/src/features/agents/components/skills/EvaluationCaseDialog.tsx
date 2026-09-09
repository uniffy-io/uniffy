import { useId, useState } from "react";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { CrepeEditor } from "@/components/editor/CrepeEditor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { selectAgentTools } from "@/features/agents/store/agentToolsSlice";
import {
  evaluationFieldsToPlain,
  type EvaluationCaseInput,
  type SerializedEvaluationCase,
} from "@/features/agents/store/agentSkillEvaluationsSerde";
import {
  saveEvaluationCase,
  type EvaluationRequestScope,
} from "@/features/agents/store/agentSkillEvaluationsThunks";

export function EvaluationCaseDialog({
  context,
  evaluationCase,
  onClose,
}: {
  context: EvaluationRequestScope;
  evaluationCase?: SerializedEvaluationCase;
  onClose: () => void;
}) {
  const dispatch = useAppDispatch();
  const fieldId = useId();
  const tools = useAppSelector(selectAgentTools);
  const [fields, setFields] = useState<EvaluationCaseInput>(
    () => evaluationCase?.fields ?? evaluationFieldsToPlain(),
  );
  const [submitting, setSubmitting] = useState(false);
  const options = tools.map((tool) => ({ value: tool.name, label: tool.displayName }));
  const fixtureNames = new Set(fields.fixtures.map((fixture) => fixture.toolName));
  const remainingTools = options.filter((tool) => !fixtureNames.has(tool.value));
  const fixtureCharacters = fields.fixtures.reduce(
    (sum, fixture) => sum + fixture.response.length,
    0,
  );
  const valid =
    fields.name.trim() &&
    fields.input.trim() &&
    fields.input.length <= 12000 &&
    fixtureCharacters <= 20000 &&
    fields.fixtures.every((fixture) => fixture.toolName);

  const change = <K extends keyof EvaluationCaseInput>(key: K, value: EvaluationCaseInput[K]) => {
    setFields((current) => ({ ...current, [key]: value }));
  };
  const updateFixture = (
    index: number,
    changes: Partial<EvaluationCaseInput["fixtures"][number]>,
  ) => {
    setFields((current) => ({
      ...current,
      fixtures: current.fixtures.map((fixture, at) =>
        at === index ? { ...fixture, ...changes } : fixture,
      ),
    }));
  };
  const save = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    const result = await dispatch(
      saveEvaluationCase({ ...context, caseId: evaluationCase?.id, fields }),
    );
    setSubmitting(false);
    if (saveEvaluationCase.fulfilled.match(result)) onClose();
  };

  return (
    <Modal onClose={onClose} closeDisabled={submitting} maxWidth="max-w-2xl">
      <ModalHeader
        title={evaluationCase ? "Edit evaluation case" : "Add evaluation case"}
        description="Describe the input, expected behavior, and sample tool responses."
      />
      <ModalBody>
        <div>
          <label htmlFor={`${fieldId}-name`} className="mb-1 block text-sm text-muted-foreground">
            Name
          </label>
          <Input
            id={`${fieldId}-name`}
            value={fields.name}
            maxLength={255}
            autoFocus
            disabled={submitting}
            onChange={(event) => change("name", event.target.value)}
          />
        </div>
        <div>
          <p className="mb-1 text-sm text-muted-foreground">Input</p>
          <Card className="p-2">
            <CrepeEditor
              contentType={ContentType.AGENT}
              contentId=""
              value={fields.input}
              onChange={(value) => change("input", value)}
              readonly={submitting}
              enableUpload={false}
              allowImages={false}
              compact
              minHeight="100px"
              placeholder="The message the agent should respond to"
            />
          </Card>
          <p className="mt-1 text-xs text-muted-foreground">
            {fields.input.length} / 12,000 characters
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-1 text-sm text-muted-foreground">Expected tools (optional)</p>
            <MultiSelect
              value={fields.expectedTools}
              options={options.filter((tool) => !fields.forbiddenTools.includes(tool.value))}
              disabled={submitting}
              onChange={(value) => change("expectedTools", value)}
              placeholder="Must be called"
            />
          </div>
          <div>
            <p className="mb-1 text-sm text-muted-foreground">Forbidden tools (optional)</p>
            <MultiSelect
              value={fields.forbiddenTools}
              options={options.filter((tool) => !fields.expectedTools.includes(tool.value))}
              disabled={submitting}
              onChange={(value) => change("forbiddenTools", value)}
              placeholder="Must never be called"
            />
          </div>
        </div>
        <div>
          <label htmlFor={`${fieldId}-rubric`} className="mb-1 block text-sm text-muted-foreground">
            Rubric (optional)
          </label>
          <Textarea
            id={`${fieldId}-rubric`}
            value={fields.rubric}
            maxLength={4000}
            rows={3}
            disabled={submitting}
            onChange={(event) => change("rubric", event.target.value)}
            placeholder="What makes the response useful and correct? Markdown is supported."
          />
        </div>
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Tool responses</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Tools return these samples during evaluation. Calls never read or change workspace
              data. A call without a sample makes the result inconclusive.
            </p>
          </div>
          {fields.fixtures.map((fixture, index) => (
            <Card key={index} className="space-y-3 p-3">
              <div className="flex items-center gap-2">
                <Select
                  value={fixture.toolName}
                  options={options.filter(
                    (tool) => tool.value === fixture.toolName || !fixtureNames.has(tool.value),
                  )}
                  ariaLabel={`Tool for response ${index + 1}`}
                  className="min-w-0 flex-1"
                  disabled={submitting}
                  onChange={(toolName) => updateFixture(index, { toolName })}
                />
                <Button
                  className="min-h-11"
                  variant="ghost"
                  disabled={submitting}
                  onClick={() =>
                    change(
                      "fixtures",
                      fields.fixtures.filter((_, at) => at !== index),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
              <Textarea
                aria-label={`Sample response ${index + 1}`}
                value={fixture.response}
                maxLength={4000}
                rows={3}
                disabled={submitting}
                onChange={(event) => updateFixture(index, { response: event.target.value })}
                placeholder="The response returned whenever this tool is called"
              />
              <Checkbox
                label="Return an error"
                checked={fixture.isError}
                disabled={submitting}
                onChange={(event) => updateFixture(index, { isError: event.target.checked })}
              />
            </Card>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              className="min-h-11"
              variant="outline"
              disabled={submitting || remainingTools.length === 0 || fields.fixtures.length >= 50}
              onClick={() =>
                change("fixtures", [
                  ...fields.fixtures,
                  { toolName: remainingTools[0].value, response: "", isError: false },
                ])
              }
            >
              Add tool response
            </Button>
            <span className="text-xs text-muted-foreground">
              {fixtureCharacters} / 20,000 characters
            </span>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button className="min-h-11" variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button className="min-h-11" onClick={save} disabled={!valid || submitting}>
          {submitting ? "Saving..." : "Save case"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
