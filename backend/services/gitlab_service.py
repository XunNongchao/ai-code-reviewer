"""
GitLab API 客户端封装

统一处理 GitLab REST API 的认证、请求、异常映射。
"""
import re
import logging
import httpx
from urllib.parse import quote
from typing import Optional

logger = logging.getLogger("gitlab_service")


class GitLabClient:
    """GitLab REST API 客户端"""

    MR_URL_PATTERN = re.compile(r"^(https?://[^/]+)/(.+?)/-/merge_requests/(\d+)")

    def __init__(self, base_url: str, private_token: str, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.private_token = private_token
        self.timeout = timeout
        self._headers = {"PRIVATE-TOKEN": private_token}

    @classmethod
    def parse_mr_url(cls, url: str) -> Optional[dict]:
        """
        解析 GitLab MR URL，返回 {base_url, project_path, mr_iid} 或 None。
        """
        match = cls.MR_URL_PATTERN.match(url.strip())
        if not match:
            return None
        return {
            "base_url": match.group(1),
            "project_path": match.group(2),
            "mr_iid": int(match.group(3)),
        }

    def _encode_project(self, project_path: str) -> str:
        return quote(project_path, safe='')

    def get_merge_request(self, project_path: str, mr_iid: int) -> dict:
        """获取 MR 基本信息（含 diff_refs）"""
        encoded = self._encode_project(project_path)
        url = f"{self.base_url}/api/v4/projects/{encoded}/merge_requests/{mr_iid}"
        logger.info("获取 MR 信息: %s !%d", project_path, mr_iid)
        resp = httpx.get(url, headers=self._headers, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def get_merge_request_changes(self, project_path: str, mr_iid: int) -> dict:
        """获取 MR 的 changes（含 diff 内容）"""
        encoded = self._encode_project(project_path)
        url = f"{self.base_url}/api/v4/projects/{encoded}/merge_requests/{mr_iid}/changes"
        logger.info("获取 MR changes: %s !%d", project_path, mr_iid)
        resp = httpx.get(url, headers=self._headers, timeout=self.timeout)
        resp.raise_for_status()
        data = resp.json()
        logger.info("MR changes 获取成功, 变更文件数=%d", len(data.get("changes", [])))
        return data

    def create_mr_note(self, project_path: str, mr_iid: int, body: str) -> dict:
        """在 MR 上创建普通 note 评论"""
        encoded = self._encode_project(project_path)
        url = f"{self.base_url}/api/v4/projects/{encoded}/merge_requests/{mr_iid}/notes"
        resp = httpx.post(
            url, headers=self._headers,
            json={"body": body},
            timeout=self.timeout
        )
        resp.raise_for_status()
        return resp.json()

    def create_discussion(self, project_path: str, mr_iid: int, body: str,
                          position: dict) -> dict:
        """在 MR 上创建行内 discussion 评论"""
        encoded = self._encode_project(project_path)
        url = f"{self.base_url}/api/v4/projects/{encoded}/merge_requests/{mr_iid}/discussions"
        payload = {"body": body, "position": position}
        logger.info("发布行内评论: %s !%d, file=%s, line=%s", project_path, mr_iid, position.get("new_path"), position.get("new_line"))
        resp = httpx.post(
            url, headers=self._headers,
            json=payload,
            timeout=self.timeout
        )
        resp.raise_for_status()
        logger.info("评论发布成功: discussion_id=%s", resp.json().get("id"))
        return resp.json()
