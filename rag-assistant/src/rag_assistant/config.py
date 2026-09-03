"""Al-Mouchir RAG assistant — configuration (pydantic-settings, 12-factor)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="RAG_", extra="ignore")

    # topology
    service_token: str = "dev-rag-token"           # must match server RAG_SERVICE_TOKEN
    host: str = "0.0.0.0"
    port: int = 8000

    # providers
    provider_mode: str = "mock"                    # mock | live
    groq_api_key: str = ""
    google_api_key: str = ""
    chat_model: str = "llama-3.3-70b-versatile"
    reranker_model: str = "llama-3.1-8b-instant"
    embed_model: str = "gemini-embedding-001"
    embed_dim: int = 1536
    daily_budget_usd: float = 5.0

    # vector store
    vector_backend: str = "mock"                   # mock | pgvector
    database_url: str = "postgresql://albaraka_ai:secret@postgres:5432/albaraka_ai"
    rag_schema: str = "rag"
    rag_table: str = "chunks"

    # retrieval defaults (runtime-tunable via DB in production; env for the demo)
    top_k_dense: int = 20
    top_k_fts: int = 20
    rrf_k: int = 60
    min_score: float = 0.35
    rerank_top: int = 8
    max_context_tokens: int = 1200

    # worker
    role: str = "api"                              # api | worker
    poll_interval_s: float = 5.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
