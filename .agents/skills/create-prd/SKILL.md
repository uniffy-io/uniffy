---
name: create-prd
description: Create a Product Requirements Document from the current conversation and save it under `.agents/plans/`. Use when the user asks for a PRD, product specification, or requirements document for an Uniffy feature.
---

# Create PRD: Generate Product Requirements Document

Generate a PRD from the current conversation context. Use the output filename supplied with the request, or `PRD.md` when none is supplied, and write it under `.agents/plans/`.

## Structure

Adapt depth to the available information; every section below, in order:

1. **Executive Summary** - overview (2-3 paragraphs), value proposition, MVP goal
2. **Mission** - mission statement, 3-5 core principles
3. **Target Users** - personas, technical comfort, needs and pain points
4. **MVP Scope** - In Scope (`- [x]`) vs Out of Scope (`- [ ]`), grouped by category
5. **User Stories** - 5-8 stories ("As a [user], I want [action], so that [benefit]") with concrete examples
6. **Core Architecture & Patterns** - for Uniffy features: domain-driven vertical slices, ConnectRPC proto-first API, multi-tenant `organization_id` scoping, URN + search requirements (`architecture.md`), and the permission model (`access_mode` + `baseline_role` + `ContentMember`, see `.agents/rules/permissions.md`)
7. **Tools/Features** - detailed feature specifications
8. **Technology Stack** - reference the stack table in `.agents/rules/architecture.md`; list new dependencies with versions
9. **Security & Configuration** - authn/authz approach, env + per-org settings tiers, both product targets (cloud + self-hosted, see AGENTS.md)
10. **API Specification** - ConnectRPC services, methods, proto messages, example payloads
11. **Search Integration** - if adding a content type, reference the Search Integration Checklist in `architecture.md`
12. **Success Criteria** - measurable functional requirements and quality indicators
13. **Implementation Phases** - 3-4 phases with goals, deliverables, validation criteria
14. **Future Considerations** - post-MVP enhancements
15. **Risks & Mitigations** - 3-5 key risks with specific mitigations
16. **Appendix** - related documents, key dependencies, structure (if applicable)

## Process

1. **Extract**: review the whole conversation; capture explicit requirements, implicit needs, constraints, and success criteria. If critical information is missing, ask before generating.
2. **Synthesize**: organize into the sections, fill reasonable assumptions where details are missing, keep terminology consistent.
3. **Write**: professional and action-oriented; markdown throughout; concrete examples over abstractions; no emojis.
4. **Confirm**: reply with the file path, a brief content summary, assumptions made, and suggested next steps (review, then the `plan-feature` and `execute` skills).
