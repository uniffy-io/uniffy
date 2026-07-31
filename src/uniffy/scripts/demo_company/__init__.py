"""Seed an organization with a demo knowledge base from a content directory."""

from uniffy.scripts.demo_company.loader import load_demo_content
from uniffy.scripts.demo_company.seeder import seed_demo_company

__all__ = ["load_demo_content", "seed_demo_company"]
