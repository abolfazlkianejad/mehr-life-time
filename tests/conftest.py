"""Shared test configuration that keeps tests away from personal databases."""

import os


os.environ["DATABASE_URL"] = "sqlite:///:memory:"
