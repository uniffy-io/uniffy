"""GitHub REST endpoints over the shared integration HTTP core."""

from __future__ import annotations

import base64
import re
from typing import Any

from uniffy.core.errors import ValidationError
from uniffy.domains.integrations.http import IntegrationHttpClient, encode_segment

_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
_REF_RE = re.compile(r"^[A-Za-z0-9._/-]+$")


def build_github_http_client(credential: str, base_url: str | None) -> IntegrationHttpClient:
    return IntegrationHttpClient(
        "github",
        base_url or "https://api.github.com",
        {
            "authorization": f"Bearer {credential}",
            "accept": "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            # GitHub rejects any request without a User-Agent header.
            "user-agent": "Uniffy-Integrations/1.0",
        },
    )


def _name_segment(field: str, value: str) -> str:
    """Owner and repo are agent input; gate them to GitHub's name charset before path insertion."""
    if not isinstance(value, str) or not _NAME_RE.fullmatch(value):
        raise ValidationError(field, "Only letters, digits, '.', '_' and '-' are allowed")
    return encode_segment(value)


def _ref_segment(field: str, value: str) -> str:
    """Refs may contain '/', so they ride raw; gate the charset and forbid traversal."""
    if not isinstance(value, str) or not _REF_RE.fullmatch(value) or ".." in value:  # noqa: PLR2004
        raise ValidationError(
            field, "Only letters, digits, '.', '_', '/' and '-' are allowed, without '..'"
        )
    return value


def _split_path(path: str) -> list[str]:
    pieces = path.split("/")
    if any(not piece for piece in pieces):
        raise ValidationError("path", "Path cannot contain empty segments")
    return pieces


def _encode_path(path: str) -> str:
    return "/".join(encode_segment(piece) for piece in _split_path(path))


def decode_file_content(payload: dict) -> str:
    """Decode the contents API base64 field; GitHub wraps it with newlines."""
    raw = (payload.get("content") or "").replace("\n", "")
    return base64.b64decode(raw).decode("utf-8", errors="replace")


class GitHubClient:
    """Stateless endpoint wrapper; auth, breaker, and response caps live in the http core."""

    def __init__(self, http: IntegrationHttpClient) -> None:
        self.http = http

    def _repo_path(self, owner: str, repo: str) -> str:
        return f"/repos/{_name_segment('owner', owner)}/{_name_segment('repo', repo)}"

    async def get_user(self) -> dict:
        return await self.http.request("GET", "/user")

    async def _search(self, path: str, query: str, limit: int, sort: str | None, page: int) -> dict:
        params: dict[str, Any] = {"q": query, "per_page": limit, "page": page}
        if sort:
            params["sort"] = sort
            params["order"] = "desc"
        return await self.http.request("GET", path, params=params)

    async def search_issues(
        self, query: str, limit: int, sort: str | None = None, page: int = 1
    ) -> dict:
        return await self._search("/search/issues", query, limit, sort, page)

    async def search_repos(
        self, query: str, limit: int, sort: str | None = None, page: int = 1
    ) -> dict:
        return await self._search("/search/repositories", query, limit, sort, page)

    async def search_code(self, query: str, limit: int, page: int = 1) -> dict:
        return await self._search("/search/code", query, limit, None, page)

    async def list_repos(self, limit: int, page: int = 1) -> list:
        return await self.http.request(
            "GET",
            "/user/repos",
            params={
                "affiliation": "owner,collaborator,organization_member",
                "sort": "updated",
                "per_page": limit,
                "page": page,
            },
        )

    async def get_repo(self, owner: str, repo: str) -> dict:
        return await self.http.request("GET", self._repo_path(owner, repo))

    async def list_branches(self, owner: str, repo: str, limit: int, page: int = 1) -> list:
        return await self.http.request(
            "GET",
            f"{self._repo_path(owner, repo)}/branches",
            params={"per_page": limit, "page": page},
        )

    async def list_releases(self, owner: str, repo: str, limit: int, page: int = 1) -> list:
        return await self.http.request(
            "GET",
            f"{self._repo_path(owner, repo)}/releases",
            params={"per_page": limit, "page": page},
        )

    async def list_commits(
        self,
        owner: str,
        repo: str,
        *,
        sha: str | None = None,
        path: str | None = None,
        author: str | None = None,
        limit: int = 20,
        page: int = 1,
    ) -> list:
        params: dict[str, Any] = {"per_page": limit, "page": page}
        if sha:
            params["sha"] = sha
        if path:
            params["path"] = "/".join(_split_path(path))
        if author:
            params["author"] = author
        return await self.http.request(
            "GET", f"{self._repo_path(owner, repo)}/commits", params=params
        )

    async def get_commit(self, owner: str, repo: str, ref: str) -> dict:
        return await self.http.request(
            "GET", f"{self._repo_path(owner, repo)}/commits/{_ref_segment('ref', ref)}"
        )

    async def get_check_runs(self, owner: str, repo: str, ref: str) -> dict:
        return await self.http.request(
            "GET",
            f"{self._repo_path(owner, repo)}/commits/{_ref_segment('ref', ref)}/check-runs",
            params={"per_page": 50},
        )

    async def get_combined_status(self, owner: str, repo: str, ref: str) -> dict:
        return await self.http.request(
            "GET", f"{self._repo_path(owner, repo)}/commits/{_ref_segment('ref', ref)}/status"
        )

    async def compare(self, owner: str, repo: str, base: str, head: str) -> dict:
        span = f"{_ref_segment('base', base)}...{_ref_segment('head', head)}"
        return await self.http.request("GET", f"{self._repo_path(owner, repo)}/compare/{span}")

    async def get_issue(self, owner: str, repo: str, number: int) -> dict:
        return await self.http.request(
            "GET", f"{self._repo_path(owner, repo)}/issues/{encode_segment(number)}"
        )

    async def list_issue_comments(self, owner: str, repo: str, number: int, limit: int = 10) -> list:
        return await self.http.request(
            "GET",
            f"{self._repo_path(owner, repo)}/issues/{encode_segment(number)}/comments",
            params={"per_page": limit},
        )

    async def list_pull_requests(
        self, owner: str, repo: str, state: str, limit: int, page: int = 1
    ) -> list:
        return await self.http.request(
            "GET",
            f"{self._repo_path(owner, repo)}/pulls",
            params={"state": state, "per_page": limit, "page": page},
        )

    async def get_pull_request(self, owner: str, repo: str, number: int) -> dict:
        return await self.http.request(
            "GET", f"{self._repo_path(owner, repo)}/pulls/{encode_segment(number)}"
        )

    async def list_pull_request_files(
        self, owner: str, repo: str, number: int, limit: int = 50, page: int = 1
    ) -> list:
        return await self.http.request(
            "GET",
            f"{self._repo_path(owner, repo)}/pulls/{encode_segment(number)}/files",
            params={"per_page": limit, "page": page},
        )

    async def list_pull_request_reviews(
        self, owner: str, repo: str, number: int, limit: int = 50
    ) -> list:
        return await self.http.request(
            "GET",
            f"{self._repo_path(owner, repo)}/pulls/{encode_segment(number)}/reviews",
            params={"per_page": limit},
        )

    async def list_pull_request_review_comments(
        self, owner: str, repo: str, number: int, limit: int = 50
    ) -> list:
        return await self.http.request(
            "GET",
            f"{self._repo_path(owner, repo)}/pulls/{encode_segment(number)}/comments",
            params={"per_page": limit},
        )

    async def get_file(self, owner: str, repo: str, path: str, ref: str | None) -> Any:
        params = {"ref": ref} if ref else None
        return await self.http.request(
            "GET",
            f"{self._repo_path(owner, repo)}/contents/{_encode_path(path)}",
            params=params,
        )
