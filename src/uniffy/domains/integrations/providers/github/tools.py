"""Read-only GitHub tools; results are scrubbed compact markdown, never raw API JSON."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from uniffy.domains.agents.tools.definitions import (
    CATEGORY_EXTERNAL,
    ToolContext,
    ToolDefinition,
    ToolResult,
)
from uniffy.domains.integrations.base import IntegrationAuthError
from uniffy.domains.integrations.format import (
    BODY_CAP,
    FILE_CAP,
    TITLE_CAP,
    scrub_external_code,
    scrub_external_text,
)

if TYPE_CHECKING:
    from uniffy.domains.integrations.http import IntegrationHttpClient

_CONNECTION_PARAM = {
    "type": "string",
    "description": "Name of the GitHub connection to use when the org has more than one.",
}
_LIMIT_PARAM = {
    "type": "integer",
    "description": "Maximum number of results (default 20, max 50).",
}
_PAGE_PARAM = {
    "type": "integer",
    "description": "Result page (50 per page, max 20).",
}
_OWNER_PARAM = {
    "type": "string",
    "description": (
        "Repository owner (user or organization). When unknown, resolve the full "
        "owner/repo form with github.search_repos first."
    ),
}
_ISSUE_SORTS = ("comments", "reactions", "created", "updated")
_REPO_SORTS = ("stars", "forks", "updated")
_LABEL_CAP = 5
_REPO_PARAM = {
    "type": "string",
    "description": "Repository name.",
}
_REF_PARAM = {
    "type": "string",
    "description": "Branch, tag, or commit SHA.",
}
_RELEASE_LIMIT_PARAM = {
    "type": "integer",
    "description": "Maximum number of releases (default 10, max 30).",
}
_FAILING_CONCLUSIONS = ("failure", "timed_out", "cancelled", "action_required", "startup_failure")
_PATCH_CAP = 4000
_DIFF_TOTAL_CAP = 40_000
_RELEASE_BODY_CAP = 2000
_REVIEW_COMMENT_CAP = 20
_COMMIT_FILES_CAP = 50
_COMPARE_COMMITS_CAP = 30


def _source_line(meta: dict, http: IntegrationHttpClient) -> str:
    host = http.base_url.split("://", 1)[-1]
    return f'Source: github connection "{meta["name"]}" ({host})'


def _repo_tail(url: str) -> str:
    return "/".join(url.rstrip("/").split("/")[-2:]) if url else ""


def _int_arg(args: dict, key: str) -> int | None:
    try:
        return int(args[key])
    except (KeyError, TypeError, ValueError):
        return None


def _clamp_limit(args: dict, default: int = 20, cap: int = 50) -> int:
    limit = _int_arg(args, "limit")
    return max(1, min(limit if limit is not None else default, cap))


def _clamp_page(args: dict) -> int:
    page = _int_arg(args, "page")
    return max(1, min(page if page is not None else 1, 20))


def _total_line(payload: dict, shown: int, page: int) -> str:
    total = payload.get("total_count", 0)
    if page > 1:
        return f"Total matches: {total} (showing {shown}, page {page})"
    return f"Total matches: {total} (showing {shown})"


def _login(payload: dict) -> str:
    return scrub_external_text((payload.get("user") or {}).get("login"), TITLE_CAP)


def _fenced(text: str) -> str:
    # Grow the fence past any backtick run so the content cannot close the block.
    fence = "```"
    while fence in text:
        fence += "`"
    return f"{fence}\n{text}\n{fence}"


def _commit_line(entry: dict) -> str:
    commit = entry.get("commit") or {}
    author = commit.get("author") or {}
    message = scrub_external_text((commit.get("message") or "").split("\n", 1)[0], TITLE_CAP)
    name = scrub_external_text(author.get("name"), TITLE_CAP)
    date = scrub_external_text(author.get("date"), TITLE_CAP)
    return f"{(entry.get('sha') or '')[:10]} {message} ({name}, {date})"


def _file_change_line(entry: dict) -> str:
    path = scrub_external_text(entry.get("filename"), TITLE_CAP)
    return f"{path} (+{entry.get('additions', 0)}/-{entry.get('deletions', 0)})"


async def _reject_credential(
    ctx: ToolContext, meta: dict[str, Any], exc: IntegrationAuthError
) -> ToolResult:
    from uniffy.domains.integrations.tool_gate import demote_connection_on_auth_error

    await demote_connection_on_auth_error(ctx, meta, exc)
    return ToolResult(
        success=False,
        data="",
        error=(
            "GitHub rejected the stored credential; an org admin must "
            f"update the connection. ({exc})"
        ),
    )


async def _execute_search_issues(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.integrations.providers.github.client import GitHubClient
    from uniffy.domains.integrations.tool_gate import resolve_connection_client

    query = args.get("query", "")
    if not query:
        return ToolResult(success=False, data="", error="query is required")
    sort = args.get("sort") or None
    if sort is not None and sort not in _ISSUE_SORTS:
        return ToolResult(
            success=False, data="", error="sort must be one of: " + ", ".join(_ISSUE_SORTS)
        )

    limit = _clamp_limit(args)
    page = _clamp_page(args)
    meta, http = await resolve_connection_client(ctx, "github", args.get("connection"))
    client = GitHubClient(http)
    try:
        payload = await client.search_issues(query, limit, sort, page)
    except IntegrationAuthError as exc:
        return await _reject_credential(ctx, meta, exc)

    items = payload.get("items") or []
    lines = [_source_line(meta, http), _total_line(payload, len(items), page)]
    if not items:
        lines.append("No matches.")
    for item in items:
        kind = "pr" if item.get("pull_request") else "issue"
        title = scrub_external_text(item.get("title"), TITLE_CAP)
        state = scrub_external_text(item.get("state"), TITLE_CAP)
        repo_name = scrub_external_text(_repo_tail(item.get("repository_url") or ""), TITLE_CAP)
        line = f"#{item.get('number')} [{kind}] {title} ({state}) - {repo_name} - @{_login(item)}"
        labels = [
            scrub_external_text(label.get("name"), TITLE_CAP)
            for label in item.get("labels") or []
            if isinstance(label, dict)
        ]
        if labels:
            shown = ", ".join(labels[:_LABEL_CAP])
            if len(labels) > _LABEL_CAP:
                shown += ", ..."
            line += f" [{shown}]"
        lines.append(line)
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_search_repos(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.integrations.providers.github.client import GitHubClient
    from uniffy.domains.integrations.tool_gate import resolve_connection_client

    query = args.get("query", "")
    if not query:
        return ToolResult(success=False, data="", error="query is required")
    sort = args.get("sort") or None
    if sort is not None and sort not in _REPO_SORTS:
        return ToolResult(
            success=False, data="", error="sort must be one of: " + ", ".join(_REPO_SORTS)
        )

    limit = _clamp_limit(args)
    page = _clamp_page(args)
    meta, http = await resolve_connection_client(ctx, "github", args.get("connection"))
    client = GitHubClient(http)
    try:
        payload = await client.search_repos(query, limit, sort, page)
    except IntegrationAuthError as exc:
        return await _reject_credential(ctx, meta, exc)

    items = payload.get("items") or []
    lines = [_source_line(meta, http), _total_line(payload, len(items), page)]
    if not items:
        lines.append("No matches.")
    for repo in items:
        full_name = scrub_external_text(repo.get("full_name"), TITLE_CAP)
        visibility = "private" if repo.get("private") else "public"
        line = f"{full_name} ({visibility}, {repo.get('stargazers_count', 0)} stars)"
        description = scrub_external_text(repo.get("description"), TITLE_CAP)
        if description:
            line += f" - {description}"
        updated = scrub_external_text(repo.get("updated_at"), TITLE_CAP)
        if updated:
            line += f" - updated {updated}"
        lines.append(line)
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_list_repos(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.integrations.providers.github.client import GitHubClient
    from uniffy.domains.integrations.tool_gate import resolve_connection_client

    limit = _clamp_limit(args)
    page = _clamp_page(args)
    meta, http = await resolve_connection_client(ctx, "github", args.get("connection"))
    client = GitHubClient(http)
    try:
        repos = await client.list_repos(limit, page)
    except IntegrationAuthError as exc:
        return await _reject_credential(ctx, meta, exc)

    lines = [_source_line(meta, http)]
    if not repos:
        lines.append("No repositories found.")
    for repo in repos or []:
        full_name = scrub_external_text(repo.get("full_name"), TITLE_CAP)
        visibility = "private" if repo.get("private") else "public"
        line = f"{full_name} ({visibility})"
        description = scrub_external_text(repo.get("description"), TITLE_CAP)
        if description:
            line += f" - {description}"
        updated = scrub_external_text(repo.get("updated_at"), TITLE_CAP)
        if updated:
            line += f" - updated {updated}"
        lines.append(line)
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_get_issue(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.integrations.providers.github.client import GitHubClient
    from uniffy.domains.integrations.tool_gate import resolve_connection_client

    owner = args.get("owner", "")
    repo = args.get("repo", "")
    if not owner or not repo:
        return ToolResult(success=False, data="", error="owner and repo are required")
    number = _int_arg(args, "number")
    if number is None:
        return ToolResult(success=False, data="", error="number is required and must be an integer")

    meta, http = await resolve_connection_client(ctx, "github", args.get("connection"))
    client = GitHubClient(http)
    try:
        issue = await client.get_issue(owner, repo, number)
        comments = await client.list_issue_comments(owner, repo, number, limit=10)
    except IntegrationAuthError as exc:
        return await _reject_credential(ctx, meta, exc)

    title = scrub_external_text(issue.get("title"), TITLE_CAP)
    state = scrub_external_text(issue.get("state"), TITLE_CAP)
    lines = [
        _source_line(meta, http),
        f"{owner}/{repo}#{number}: {title}",
        f"State: {state} - @{_login(issue)}",
    ]
    labels = ", ".join(
        scrub_external_text(label.get("name"), TITLE_CAP)
        for label in issue.get("labels") or []
        if isinstance(label, dict)
    )
    if labels:
        lines.append(f"Labels: {labels}")
    lines.append(f"Created: {issue.get('created_at')} - Updated: {issue.get('updated_at')}")
    body = scrub_external_text(issue.get("body"), BODY_CAP)
    if body:
        lines.extend(["", body])
    if comments:
        lines.extend(["", f"Comments ({len(comments)}):"])
        for comment in comments:
            author = _login(comment)
            comment_body = scrub_external_text(comment.get("body"), BODY_CAP)
            lines.append(f"@{author} ({comment.get('created_at')}): {comment_body}")
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_list_pull_requests(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.integrations.providers.github.client import GitHubClient
    from uniffy.domains.integrations.tool_gate import resolve_connection_client

    owner = args.get("owner", "")
    repo = args.get("repo", "")
    if not owner or not repo:
        return ToolResult(success=False, data="", error="owner and repo are required")
    state = args.get("state") or "open"
    if state not in ("open", "closed", "all"):
        return ToolResult(success=False, data="", error="state must be one of: open, closed, all")

    limit = _clamp_limit(args)
    page = _clamp_page(args)
    meta, http = await resolve_connection_client(ctx, "github", args.get("connection"))
    client = GitHubClient(http)
    try:
        pulls = await client.list_pull_requests(owner, repo, state, limit, page)
    except IntegrationAuthError as exc:
        return await _reject_credential(ctx, meta, exc)

    lines = [_source_line(meta, http)]
    if not pulls:
        lines.append(f"No {state} pull requests found in {owner}/{repo}.")
    for pull in pulls or []:
        title = scrub_external_text(pull.get("title"), TITLE_CAP)
        pull_state = scrub_external_text(pull.get("state"), TITLE_CAP)
        head = scrub_external_text((pull.get("head") or {}).get("ref"), TITLE_CAP)
        base = scrub_external_text((pull.get("base") or {}).get("ref"), TITLE_CAP)
        lines.append(
            f"#{pull.get('number')} {title} ({pull_state}) - {head} -> {base}"
            f" - @{_login(pull)} - {pull.get('updated_at')}"
        )
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_get_pull_request(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.integrations.providers.github.client import GitHubClient
    from uniffy.domains.integrations.tool_gate import resolve_connection_client

    owner = args.get("owner", "")
    repo = args.get("repo", "")
    if not owner or not repo:
        return ToolResult(success=False, data="", error="owner and repo are required")
    number = _int_arg(args, "number")
    if number is None:
        return ToolResult(success=False, data="", error="number is required and must be an integer")

    meta, http = await resolve_connection_client(ctx, "github", args.get("connection"))
    client = GitHubClient(http)
    try:
        pull = await client.get_pull_request(owner, repo, number)
        files = await client.list_pull_request_files(owner, repo, number)
    except IntegrationAuthError as exc:
        return await _reject_credential(ctx, meta, exc)

    title = scrub_external_text(pull.get("title"), TITLE_CAP)
    state = scrub_external_text(pull.get("state"), TITLE_CAP)
    head = scrub_external_text((pull.get("head") or {}).get("ref"), TITLE_CAP)
    base = scrub_external_text((pull.get("base") or {}).get("ref"), TITLE_CAP)
    state_line = f"State: {state}"
    if pull.get("draft"):
        state_line += " (draft)"
    lines = [
        _source_line(meta, http),
        f"{owner}/{repo}#{number}: {title}",
        f"{state_line} - @{_login(pull)}",
        f"Branches: {head} -> {base}",
    ]
    mergeable_state = pull.get("mergeable_state")
    if mergeable_state:
        lines.append(f"Mergeable state: {scrub_external_text(mergeable_state, TITLE_CAP)}")
    lines.append(f"Created: {pull.get('created_at')} - Updated: {pull.get('updated_at')}")
    body = scrub_external_text(pull.get("body"), BODY_CAP)
    if body:
        lines.extend(["", body])

    files = files or []
    total_changed = pull.get("changed_files")
    shown = f" ({total_changed} total)" if isinstance(total_changed, int) else ""
    lines.extend(["", f"Files changed{shown}:"])
    lines.extend(_file_change_line(entry) for entry in files)
    if isinstance(total_changed, int) and len(files) < total_changed:
        lines.append(f"[showing first {len(files)} of {total_changed} changed files]")
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_get_file(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.integrations.providers.github.client import (
        GitHubClient,
        decode_file_content,
    )
    from uniffy.domains.integrations.tool_gate import resolve_connection_client

    owner = args.get("owner", "")
    repo = args.get("repo", "")
    path = args.get("path", "")
    if not owner or not repo or not path:
        return ToolResult(success=False, data="", error="owner, repo and path are required")

    meta, http = await resolve_connection_client(ctx, "github", args.get("connection"))
    client = GitHubClient(http)
    try:
        payload = await client.get_file(owner, repo, path, args.get("ref") or None)
    except IntegrationAuthError as exc:
        return await _reject_credential(ctx, meta, exc)

    source = _source_line(meta, http)
    if isinstance(payload, list):
        lines = [source, f"Directory {path}:"]
        for entry in payload:
            name = scrub_external_text(entry.get("name"), TITLE_CAP)
            entry_type = scrub_external_text(entry.get("type"), TITLE_CAP)
            lines.append(f"{name} ({entry_type}, {entry.get('size', 0)})")
        return ToolResult(success=True, data="\n".join(lines))

    entry_type = payload.get("type")
    if entry_type != "file":
        kind = scrub_external_text(entry_type, TITLE_CAP) or "unknown"
        return ToolResult(
            success=True,
            data=f"{source}\n{path} is a {kind} entry; its content cannot be rendered.",
        )

    text = scrub_external_code(decode_file_content(payload), FILE_CAP)
    return ToolResult(success=True, data=f"{source}\n## {path}\n{_fenced(text)}")


async def _execute_get_pull_request_diff(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.integrations.providers.github.client import GitHubClient
    from uniffy.domains.integrations.tool_gate import resolve_connection_client

    owner = args.get("owner", "")
    repo = args.get("repo", "")
    if not owner or not repo:
        return ToolResult(success=False, data="", error="owner and repo are required")
    number = _int_arg(args, "number")
    if number is None:
        return ToolResult(success=False, data="", error="number is required and must be an integer")

    page = _clamp_page(args)
    meta, http = await resolve_connection_client(ctx, "github", args.get("connection"))
    client = GitHubClient(http)
    try:
        files = await client.list_pull_request_files(owner, repo, number, page=page)
    except IntegrationAuthError as exc:
        return await _reject_credential(ctx, meta, exc)

    files = files or []
    lines = [_source_line(meta, http)]
    if not files:
        suffix = f" on page {page}" if page > 1 else ""
        lines.append(f"No changed files{suffix}.")
        return ToolResult(success=True, data="\n".join(lines))

    budget = _DIFF_TOTAL_CAP
    skipped = 0
    for entry in files:
        if budget <= 0:
            skipped += 1
            continue
        header = f"### {_file_change_line(entry)}"
        patch = entry.get("patch")
        if not patch:
            lines.extend([header, "(binary or too large, no diff)"])
            continue
        text = scrub_external_code(patch, min(_PATCH_CAP, budget))
        budget -= len(header) + len(text)
        lines.extend([header, _fenced(text)])
    if skipped:
        lines.append(
            f"[{skipped} more files not shown: {_DIFF_TOTAL_CAP:,} character total cap;"
            " request the next page or narrow the pull request]"
        )
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_list_commits(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.integrations.providers.github.client import GitHubClient
    from uniffy.domains.integrations.tool_gate import resolve_connection_client

    owner = args.get("owner", "")
    repo = args.get("repo", "")
    if not owner or not repo:
        return ToolResult(success=False, data="", error="owner and repo are required")

    limit = _clamp_limit(args)
    page = _clamp_page(args)
    meta, http = await resolve_connection_client(ctx, "github", args.get("connection"))
    client = GitHubClient(http)
    try:
        commits = await client.list_commits(
            owner,
            repo,
            sha=args.get("sha") or None,
            path=args.get("path") or None,
            author=args.get("author") or None,
            limit=limit,
            page=page,
        )
    except IntegrationAuthError as exc:
        return await _reject_credential(ctx, meta, exc)

    lines = [_source_line(meta, http)]
    if not commits:
        lines.append("No commits found.")
    lines.extend(_commit_line(entry) for entry in commits or [])
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_get_commit(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.integrations.providers.github.client import GitHubClient
    from uniffy.domains.integrations.tool_gate import resolve_connection_client

    owner = args.get("owner", "")
    repo = args.get("repo", "")
    ref = args.get("ref", "")
    if not owner or not repo or not ref:
        return ToolResult(success=False, data="", error="owner, repo and ref are required")

    meta, http = await resolve_connection_client(ctx, "github", args.get("connection"))
    client = GitHubClient(http)
    try:
        payload = await client.get_commit(owner, repo, ref)
    except IntegrationAuthError as exc:
        return await _reject_credential(ctx, meta, exc)

    commit = payload.get("commit") or {}
    author = commit.get("author") or {}
    sha = scrub_external_text(payload.get("sha"), TITLE_CAP)
    name = scrub_external_text(author.get("name"), TITLE_CAP)
    date = scrub_external_text(author.get("date"), TITLE_CAP)
    lines = [
        _source_line(meta, http),
        f"{owner}/{repo}@{sha}",
        f"Author: {name} ({date})",
    ]
    message = scrub_external_text(commit.get("message"), BODY_CAP)
    if message:
        lines.extend(["", message])
    stats = payload.get("stats") or {}
    files = payload.get("files") or []
    lines.extend(
        [
            "",
            f"Stats: +{stats.get('additions', 0)}/-{stats.get('deletions', 0)},"
            f" {len(files)} files",
        ]
    )
    lines.extend(_file_change_line(entry) for entry in files[:_COMMIT_FILES_CAP])
    if len(files) > _COMMIT_FILES_CAP:
        lines.append(f"[showing first {_COMMIT_FILES_CAP} of {len(files)} changed files]")
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_get_checks(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.integrations.providers.github.client import GitHubClient
    from uniffy.domains.integrations.tool_gate import resolve_connection_client

    owner = args.get("owner", "")
    repo = args.get("repo", "")
    ref = args.get("ref", "")
    if not owner or not repo or not ref:
        return ToolResult(success=False, data="", error="owner, repo and ref are required")

    meta, http = await resolve_connection_client(ctx, "github", args.get("connection"))
    client = GitHubClient(http)
    try:
        checks = await client.get_check_runs(owner, repo, ref)
        status = await client.get_combined_status(owner, repo, ref)
    except IntegrationAuthError as exc:
        return await _reject_credential(ctx, meta, exc)

    state = scrub_external_text(status.get("state"), TITLE_CAP)
    lines = [_source_line(meta, http), f"Combined status: {state}"]
    runs = checks.get("check_runs") or []
    if not runs:
        lines.append("No check runs.")
    for run in sorted(runs, key=lambda r: r.get("conclusion") not in _FAILING_CONCLUSIONS):
        name = scrub_external_text(run.get("name"), TITLE_CAP)
        conclusion = scrub_external_text(run.get("conclusion"), TITLE_CAP) or "pending"
        run_status = scrub_external_text(run.get("status"), TITLE_CAP)
        lines.append(f"{name}: {conclusion} ({run_status})")
        if run.get("conclusion") in _FAILING_CONCLUSIONS:
            title = scrub_external_text((run.get("output") or {}).get("title"), TITLE_CAP)
            if title:
                lines.append(f"  {title}")
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_list_pr_reviews(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.integrations.providers.github.client import GitHubClient
    from uniffy.domains.integrations.tool_gate import resolve_connection_client

    owner = args.get("owner", "")
    repo = args.get("repo", "")
    if not owner or not repo:
        return ToolResult(success=False, data="", error="owner and repo are required")
    number = _int_arg(args, "number")
    if number is None:
        return ToolResult(success=False, data="", error="number is required and must be an integer")

    meta, http = await resolve_connection_client(ctx, "github", args.get("connection"))
    client = GitHubClient(http)
    try:
        reviews = await client.list_pull_request_reviews(owner, repo, number)
        comments = await client.list_pull_request_review_comments(owner, repo, number)
    except IntegrationAuthError as exc:
        return await _reject_credential(ctx, meta, exc)

    reviews = reviews or []
    comments = comments or []
    lines = [_source_line(meta, http)]
    if not reviews:
        lines.append("No reviews.")
    for review in reviews:
        review_state = scrub_external_text(review.get("state"), TITLE_CAP)
        lines.append(f"@{_login(review)}: {review_state} ({review.get('submitted_at')})")
        body = scrub_external_text(review.get("body"), BODY_CAP)
        if body:
            lines.append(body)
    if comments:
        lines.extend(["", f"Inline comments ({len(comments)}):"])
        for comment in comments[:_REVIEW_COMMENT_CAP]:
            path = scrub_external_text(comment.get("path"), TITLE_CAP)
            line_no = comment.get("line") or comment.get("original_line")
            location = f"{path}:{line_no}" if line_no else path
            body = scrub_external_text(comment.get("body"), BODY_CAP)
            lines.append(f"@{_login(comment)} on {location}: {body}")
        if len(comments) > _REVIEW_COMMENT_CAP:
            lines.append(
                f"[showing first {_REVIEW_COMMENT_CAP} of {len(comments)} inline comments]"
            )
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_search_code(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.integrations.providers.github.client import GitHubClient
    from uniffy.domains.integrations.tool_gate import resolve_connection_client

    query = args.get("query", "")
    if not query:
        return ToolResult(success=False, data="", error="query is required")

    limit = _clamp_limit(args)
    page = _clamp_page(args)
    meta, http = await resolve_connection_client(ctx, "github", args.get("connection"))
    client = GitHubClient(http)
    try:
        payload = await client.search_code(query, limit, page)
    except IntegrationAuthError as exc:
        return await _reject_credential(ctx, meta, exc)

    items = payload.get("items") or []
    lines = [_source_line(meta, http), _total_line(payload, len(items), page)]
    if not items:
        lines.append("No matches.")
    for item in items:
        repo_name = scrub_external_text((item.get("repository") or {}).get("full_name"), TITLE_CAP)
        path = scrub_external_text(item.get("path"), TITLE_CAP)
        lines.append(f"{repo_name}: {path}")
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_compare(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.integrations.providers.github.client import GitHubClient
    from uniffy.domains.integrations.tool_gate import resolve_connection_client

    owner = args.get("owner", "")
    repo = args.get("repo", "")
    base = args.get("base", "")
    head = args.get("head", "")
    if not owner or not repo or not base or not head:
        return ToolResult(success=False, data="", error="owner, repo, base and head are required")

    meta, http = await resolve_connection_client(ctx, "github", args.get("connection"))
    client = GitHubClient(http)
    try:
        payload = await client.compare(owner, repo, base, head)
    except IntegrationAuthError as exc:
        return await _reject_credential(ctx, meta, exc)

    total = payload.get("total_commits", 0)
    lines = [
        _source_line(meta, http),
        f"{owner}/{repo} {base}...{head}: ahead {payload.get('ahead_by', 0)},"
        f" behind {payload.get('behind_by', 0)}, {total} commits",
    ]
    commits = payload.get("commits") or []
    lines.extend(_commit_line(entry) for entry in commits[:_COMPARE_COMMITS_CAP])
    if len(commits) > _COMPARE_COMMITS_CAP:
        lines.append(f"[showing first {_COMPARE_COMMITS_CAP} of {total} commits]")
    files = payload.get("files") or []
    if files:
        lines.extend(["", "Files changed:"])
        lines.extend(_file_change_line(entry) for entry in files[:_COMMIT_FILES_CAP])
        if len(files) > _COMMIT_FILES_CAP:
            lines.append(f"[showing first {_COMMIT_FILES_CAP} of {len(files)} changed files]")
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_get_repo(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.integrations.providers.github.client import GitHubClient
    from uniffy.domains.integrations.tool_gate import resolve_connection_client

    owner = args.get("owner", "")
    repo = args.get("repo", "")
    if not owner or not repo:
        return ToolResult(success=False, data="", error="owner and repo are required")

    meta, http = await resolve_connection_client(ctx, "github", args.get("connection"))
    client = GitHubClient(http)
    try:
        payload = await client.get_repo(owner, repo)
    except IntegrationAuthError as exc:
        return await _reject_credential(ctx, meta, exc)

    full_name = scrub_external_text(payload.get("full_name"), TITLE_CAP)
    visibility = "private" if payload.get("private") else "public"
    title = f"{full_name} ({visibility})"
    if payload.get("archived"):
        title += " [archived]"
    lines = [_source_line(meta, http), title]
    default_branch = scrub_external_text(payload.get("default_branch"), TITLE_CAP)
    if default_branch:
        lines.append(f"Default branch: {default_branch}")
    description = scrub_external_text(payload.get("description"), TITLE_CAP)
    if description:
        lines.append(description)
    topics = [scrub_external_text(topic, TITLE_CAP) for topic in payload.get("topics") or []]
    if topics:
        lines.append("Topics: " + ", ".join(topics))
    lines.append(
        f"Stars: {payload.get('stargazers_count', 0)} - Forks: {payload.get('forks_count', 0)}"
        f" - Open issues: {payload.get('open_issues_count', 0)}"
    )
    pushed = scrub_external_text(payload.get("pushed_at"), TITLE_CAP)
    if pushed:
        lines.append(f"Pushed: {pushed}")
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_list_branches(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.integrations.providers.github.client import GitHubClient
    from uniffy.domains.integrations.tool_gate import resolve_connection_client

    owner = args.get("owner", "")
    repo = args.get("repo", "")
    if not owner or not repo:
        return ToolResult(success=False, data="", error="owner and repo are required")

    limit = _clamp_limit(args)
    page = _clamp_page(args)
    meta, http = await resolve_connection_client(ctx, "github", args.get("connection"))
    client = GitHubClient(http)
    try:
        branches = await client.list_branches(owner, repo, limit, page)
    except IntegrationAuthError as exc:
        return await _reject_credential(ctx, meta, exc)

    lines = [_source_line(meta, http)]
    if not branches:
        lines.append("No branches found.")
    for branch in branches or []:
        name = scrub_external_text(branch.get("name"), TITLE_CAP)
        sha = ((branch.get("commit") or {}).get("sha") or "")[:10]
        line = f"{name} ({sha})"
        if branch.get("protected"):
            line += " (protected)"
        lines.append(line)
    return ToolResult(success=True, data="\n".join(lines))


async def _execute_list_releases(ctx: ToolContext, args: dict) -> ToolResult:
    from uniffy.domains.integrations.providers.github.client import GitHubClient
    from uniffy.domains.integrations.tool_gate import resolve_connection_client

    owner = args.get("owner", "")
    repo = args.get("repo", "")
    if not owner or not repo:
        return ToolResult(success=False, data="", error="owner and repo are required")

    limit = _clamp_limit(args, default=10, cap=30)
    page = _clamp_page(args)
    meta, http = await resolve_connection_client(ctx, "github", args.get("connection"))
    client = GitHubClient(http)
    try:
        releases = await client.list_releases(owner, repo, limit, page)
    except IntegrationAuthError as exc:
        return await _reject_credential(ctx, meta, exc)

    lines = [_source_line(meta, http)]
    if not releases:
        lines.append("No releases found.")
    for index, release in enumerate(releases or []):
        if index:
            lines.append("")
        tag = scrub_external_text(release.get("tag_name"), TITLE_CAP)
        name = scrub_external_text(release.get("name"), TITLE_CAP)
        line = " ".join(piece for piece in (tag, name) if piece)
        published = scrub_external_text(release.get("published_at"), TITLE_CAP)
        if published:
            line += f" ({published})"
        if release.get("draft"):
            line += " [draft]"
        if release.get("prerelease"):
            line += " [prerelease]"
        lines.append(line)
        body = scrub_external_text(release.get("body"), _RELEASE_BODY_CAP)
        if body:
            lines.append(body)
    return ToolResult(success=True, data="\n".join(lines))


search_issues = ToolDefinition(
    name="github.search_issues",
    display_name="Search Issues",
    group="GitHub",
    category=CATEGORY_EXTERNAL,
    description=(
        "Search issues and pull requests on GitHub. The query supports GitHub search "
        "syntax qualifiers such as repo:owner/name, is:pr, is:issue, state:open, "
        "author:username, label:name, and ranges like comments:>10 or reactions:>50. "
        "The sort argument orders the results; the default is best match. When only "
        "a bare repository name is known, resolve the owner with github.search_repos first."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "GitHub search query."},
            "sort": {
                "type": "string",
                "enum": ["comments", "reactions", "created", "updated"],
                "description": "Sort order for the results (default best match).",
            },
            "connection": _CONNECTION_PARAM,
            "limit": _LIMIT_PARAM,
            "page": _PAGE_PARAM,
        },
        "required": ["query"],
    },
    executor=_execute_search_issues,
    read_only=True,
    timeout_seconds=30,
)

search_repos = ToolDefinition(
    name="github.search_repos",
    display_name="Search Repositories",
    group="GitHub",
    category=CATEGORY_EXTERNAL,
    description=(
        "Search repositories on GitHub by name or keywords. Use this first to resolve "
        "a bare repository name to its full owner/repo form. The query supports "
        "qualifiers such as user:name, org:name, language:python, stars:>100."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "GitHub search query."},
            "sort": {
                "type": "string",
                "enum": ["stars", "forks", "updated"],
                "description": "Sort order for the results (default best match).",
            },
            "connection": _CONNECTION_PARAM,
            "limit": _LIMIT_PARAM,
            "page": _PAGE_PARAM,
        },
        "required": ["query"],
    },
    executor=_execute_search_repos,
    read_only=True,
    timeout_seconds=30,
)

list_repos = ToolDefinition(
    name="github.list_repos",
    display_name="List Repositories",
    group="GitHub",
    category=CATEGORY_EXTERNAL,
    description=(
        "List repositories the connected GitHub account can access, most recently updated first."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "connection": _CONNECTION_PARAM,
            "limit": _LIMIT_PARAM,
            "page": _PAGE_PARAM,
        },
    },
    executor=_execute_list_repos,
    read_only=True,
    timeout_seconds=30,
)

get_issue = ToolDefinition(
    name="github.get_issue",
    display_name="Read Issue",
    group="GitHub",
    category=CATEGORY_EXTERNAL,
    description="Read a GitHub issue: title, state, labels, body, and its most recent comments.",
    parameter_schema={
        "type": "object",
        "properties": {
            "owner": _OWNER_PARAM,
            "repo": _REPO_PARAM,
            "number": {"type": "integer", "description": "Issue number."},
            "connection": _CONNECTION_PARAM,
        },
        "required": ["owner", "repo", "number"],
    },
    executor=_execute_get_issue,
    read_only=True,
    timeout_seconds=30,
)

list_pull_requests = ToolDefinition(
    name="github.list_pull_requests",
    display_name="List Pull Requests",
    group="GitHub",
    category=CATEGORY_EXTERNAL,
    description="List pull requests in a GitHub repository.",
    parameter_schema={
        "type": "object",
        "properties": {
            "owner": _OWNER_PARAM,
            "repo": _REPO_PARAM,
            "state": {
                "type": "string",
                "enum": ["open", "closed", "all"],
                "description": "Pull request state filter (default open).",
            },
            "connection": _CONNECTION_PARAM,
            "limit": _LIMIT_PARAM,
            "page": _PAGE_PARAM,
        },
        "required": ["owner", "repo"],
    },
    executor=_execute_list_pull_requests,
    read_only=True,
    timeout_seconds=30,
)

get_pull_request = ToolDefinition(
    name="github.get_pull_request",
    display_name="Read Pull Request",
    group="GitHub",
    category=CATEGORY_EXTERNAL,
    description=(
        "Read a GitHub pull request: title, state, branches, body, and the list of "
        "changed files with additions and deletions."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "owner": _OWNER_PARAM,
            "repo": _REPO_PARAM,
            "number": {"type": "integer", "description": "Pull request number."},
            "connection": _CONNECTION_PARAM,
        },
        "required": ["owner", "repo", "number"],
    },
    executor=_execute_get_pull_request,
    read_only=True,
    timeout_seconds=30,
)

get_file = ToolDefinition(
    name="github.get_file",
    display_name="Read File",
    group="GitHub",
    category=CATEGORY_EXTERNAL,
    description="Read a file or list a directory from a GitHub repository.",
    parameter_schema={
        "type": "object",
        "properties": {
            "owner": _OWNER_PARAM,
            "repo": _REPO_PARAM,
            "path": {
                "type": "string",
                "description": "File or directory path within the repository.",
            },
            "ref": {
                "type": "string",
                "description": "Branch, tag, or commit SHA (default branch when omitted).",
            },
            "connection": _CONNECTION_PARAM,
        },
        "required": ["owner", "repo", "path"],
    },
    executor=_execute_get_file,
    read_only=True,
    timeout_seconds=30,
)

get_pull_request_diff = ToolDefinition(
    name="github.get_pull_request_diff",
    display_name="Read Pull Request Diff",
    group="GitHub",
    category=CATEGORY_EXTERNAL,
    description=(
        "Read a GitHub pull request's diff as per-file patch hunks, 50 files per page. "
        "Long patches are truncated; use github.get_file for full file context."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "owner": _OWNER_PARAM,
            "repo": _REPO_PARAM,
            "number": {"type": "integer", "description": "Pull request number."},
            "page": {"type": "integer", "description": "File page (50 per page, max 20)."},
            "connection": _CONNECTION_PARAM,
        },
        "required": ["owner", "repo", "number"],
    },
    executor=_execute_get_pull_request_diff,
    read_only=True,
    timeout_seconds=30,
)

list_commits = ToolDefinition(
    name="github.list_commits",
    display_name="List Commits",
    group="GitHub",
    category=CATEGORY_EXTERNAL,
    description=(
        "List commits in a GitHub repository, optionally filtered to a branch or SHA, "
        "a file path, or an author."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "owner": _OWNER_PARAM,
            "repo": _REPO_PARAM,
            "sha": {
                "type": "string",
                "description": "Branch, tag, or SHA to list from (default branch when omitted).",
            },
            "path": {
                "type": "string",
                "description": "Only commits touching this file or directory path.",
            },
            "author": {"type": "string", "description": "Filter by author login or email."},
            "connection": _CONNECTION_PARAM,
            "limit": _LIMIT_PARAM,
            "page": _PAGE_PARAM,
        },
        "required": ["owner", "repo"],
    },
    executor=_execute_list_commits,
    read_only=True,
    timeout_seconds=30,
)

get_commit = ToolDefinition(
    name="github.get_commit",
    display_name="Read Commit",
    group="GitHub",
    category=CATEGORY_EXTERNAL,
    description=(
        "Read a GitHub commit: author, full message, stats, and changed file paths. "
        "No patch hunks; github.get_pull_request_diff serves those for a pull request."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "owner": _OWNER_PARAM,
            "repo": _REPO_PARAM,
            "ref": _REF_PARAM,
            "connection": _CONNECTION_PARAM,
        },
        "required": ["owner", "repo", "ref"],
    },
    executor=_execute_get_commit,
    read_only=True,
    timeout_seconds=30,
)

get_checks = ToolDefinition(
    name="github.get_checks",
    display_name="Read CI Checks",
    group="GitHub",
    category=CATEGORY_EXTERNAL,
    description=(
        "Read CI results for a commit ref: the combined status plus every check run, "
        "failing runs first."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "owner": _OWNER_PARAM,
            "repo": _REPO_PARAM,
            "ref": _REF_PARAM,
            "connection": _CONNECTION_PARAM,
        },
        "required": ["owner", "repo", "ref"],
    },
    executor=_execute_get_checks,
    read_only=True,
    timeout_seconds=30,
)

list_pr_reviews = ToolDefinition(
    name="github.list_pr_reviews",
    display_name="Read Reviews",
    group="GitHub",
    category=CATEGORY_EXTERNAL,
    description="Read a GitHub pull request's reviews and inline review comments.",
    parameter_schema={
        "type": "object",
        "properties": {
            "owner": _OWNER_PARAM,
            "repo": _REPO_PARAM,
            "number": {"type": "integer", "description": "Pull request number."},
            "connection": _CONNECTION_PARAM,
        },
        "required": ["owner", "repo", "number"],
    },
    executor=_execute_list_pr_reviews,
    read_only=True,
    timeout_seconds=30,
)

search_code = ToolDefinition(
    name="github.search_code",
    display_name="Search Code",
    group="GitHub",
    category=CATEGORY_EXTERNAL,
    description=(
        "Search file contents on GitHub. Matches default branches only and shares a "
        "10 requests/minute pool, so batch queries with qualifiers such as repo:owner/name, "
        "org:name, language:python, filename:app.py. Read a hit with github.get_file."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "GitHub code search query."},
            "connection": _CONNECTION_PARAM,
            "limit": _LIMIT_PARAM,
            "page": _PAGE_PARAM,
        },
        "required": ["query"],
    },
    executor=_execute_search_code,
    read_only=True,
    timeout_seconds=30,
)

compare = ToolDefinition(
    name="github.compare",
    display_name="Compare Refs",
    group="GitHub",
    category=CATEGORY_EXTERNAL,
    description=(
        "Compare two refs in a GitHub repository (base...head): ahead/behind counts, "
        "commits, and changed files."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "owner": _OWNER_PARAM,
            "repo": _REPO_PARAM,
            "base": {"type": "string", "description": "Base branch, tag, or commit SHA."},
            "head": {"type": "string", "description": "Head branch, tag, or commit SHA."},
            "connection": _CONNECTION_PARAM,
        },
        "required": ["owner", "repo", "base", "head"],
    },
    executor=_execute_compare,
    read_only=True,
    timeout_seconds=30,
)

get_repo = ToolDefinition(
    name="github.get_repo",
    display_name="Read Repository",
    group="GitHub",
    category=CATEGORY_EXTERNAL,
    description=(
        "Read GitHub repository metadata: description, topics, activity, and the "
        "default branch github.get_file reads when ref is omitted."
    ),
    parameter_schema={
        "type": "object",
        "properties": {
            "owner": _OWNER_PARAM,
            "repo": _REPO_PARAM,
            "connection": _CONNECTION_PARAM,
        },
        "required": ["owner", "repo"],
    },
    executor=_execute_get_repo,
    read_only=True,
    timeout_seconds=30,
)

list_branches = ToolDefinition(
    name="github.list_branches",
    display_name="List Branches",
    group="GitHub",
    category=CATEGORY_EXTERNAL,
    description="List branches in a GitHub repository.",
    parameter_schema={
        "type": "object",
        "properties": {
            "owner": _OWNER_PARAM,
            "repo": _REPO_PARAM,
            "connection": _CONNECTION_PARAM,
            "limit": _LIMIT_PARAM,
            "page": _PAGE_PARAM,
        },
        "required": ["owner", "repo"],
    },
    executor=_execute_list_branches,
    read_only=True,
    timeout_seconds=30,
)

list_releases = ToolDefinition(
    name="github.list_releases",
    display_name="List Releases",
    group="GitHub",
    category=CATEGORY_EXTERNAL,
    description="List releases in a GitHub repository with their notes, newest first.",
    parameter_schema={
        "type": "object",
        "properties": {
            "owner": _OWNER_PARAM,
            "repo": _REPO_PARAM,
            "connection": _CONNECTION_PARAM,
            "limit": _RELEASE_LIMIT_PARAM,
            "page": _PAGE_PARAM,
        },
        "required": ["owner", "repo"],
    },
    executor=_execute_list_releases,
    read_only=True,
    timeout_seconds=30,
)

GITHUB_TOOLS: list[ToolDefinition] = [
    search_issues,
    search_repos,
    search_code,
    list_repos,
    get_repo,
    list_branches,
    list_releases,
    get_file,
    get_issue,
    list_pull_requests,
    get_pull_request,
    get_pull_request_diff,
    list_pr_reviews,
    list_commits,
    get_commit,
    compare,
    get_checks,
]
