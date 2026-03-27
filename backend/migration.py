"""
TOML to SQLite Migration Script

Usage:
    cd backend
    python migration.py              # Run migration
    python migration.py --dry-run    # Preview without changes
    python migration.py --verify     # Verify migration
"""
import os
import sys
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import toml
except ImportError:
    print("Error: toml package not found. Install with: pip install toml")
    sys.exit(1)

from database import get_db, ConfigRepository, LLMProviderRepository


def migrate_toml_to_sqlite(toml_path: str = None, dry_run: bool = False) -> bool:
    """
    Migrate configuration from TOML to SQLite.

    Args:
        toml_path: Path to config.toml (defaults to backend/config.toml)
        dry_run: If True, only print what would be migrated without making changes
    """
    if toml_path is None:
        toml_path = os.path.join(os.path.dirname(__file__), "config.toml")

    if not os.path.exists(toml_path):
        print(f"Warning: TOML file not found at {toml_path}")
        print("Creating default configuration in SQLite...")
        return create_default_config(dry_run)

    print(f"Reading TOML configuration from: {toml_path}")
    config = toml.load(toml_path)

    if dry_run:
        print("\n=== DRY RUN MODE - No changes will be made ===\n")

    db = get_db()
    config_repo = ConfigRepository(db)
    provider_repo = LLMProviderRepository(db)

    # Step 1: Migrate LLM Provider Credentials
    print("\n--- Migrating LLM Provider Credentials ---")
    credentials = config.get("credentials", {})
    migrated_providers = []

    for provider_name, creds in credentials.items():
        base_url = creds.get("base_url")
        api_key = creds.get("api_key", "CHANGEME")

        print(f"  Provider: {provider_name}")
        print(f"    base_url: {base_url or 'default'}")
        print(f"    api_key: {'***' + api_key[-4:] if len(api_key) > 4 and api_key != 'CHANGEME' else api_key}")

        if not dry_run:
            provider_repo.upsert(provider_name, base_url, api_key)

        migrated_providers.append(provider_name)

    # Step 2: Migrate Active Settings / LLM Config
    print("\n--- Migrating Active Configuration ---")

    # Support both old (active_settings) and new (llm_config) formats
    active_config = config.get("llm_config") or config.get("active_settings", {})

    settings_update = {
        'active_provider': active_config.get('provider', 'openai'),
        'active_model': active_config.get('model_name', 'gpt-4o-mini'),
        'default_prompt': config.get("rules", {}).get("default_prompt", "你是一个代码审查专家。"),
    }

    # If llm_config has its own base_url/api_key, create/update the provider
    provider_name = active_config.get('provider', 'openai')
    if active_config.get('api_key') and active_config.get('api_key') not in ('CHANGEME', '', None):
        base_url = active_config.get('base_url')
        api_key = active_config.get('api_key')

        if not dry_run:
            provider_repo.upsert(provider_name, base_url, api_key)
        print(f"  Created/updated active provider: {provider_name}")
        print(f"    base_url: {base_url or 'default'}")

    print(f"  active_provider: {settings_update['active_provider']}")
    print(f"  active_model: {settings_update['active_model']}")
    prompt_preview = settings_update['default_prompt'][:50] + "..." if len(settings_update['default_prompt']) > 50 else settings_update['default_prompt']
    print(f"  default_prompt: {prompt_preview}")

    if not dry_run:
        config_repo.update_settings(**settings_update)

    # Step 3: Migrate GitLab Settings
    print("\n--- Migrating GitLab Settings ---")
    gitlab_config = config.get("gitlab", {})

    gitlab_update = {
        'gitlab_url': gitlab_config.get('url', 'https://gitlab.example.com'),
        'gitlab_token': gitlab_config.get('private_token'),
    }

    print(f"  gitlab_url: {gitlab_update['gitlab_url']}")
    token = gitlab_update['gitlab_token']
    if token and len(token) > 4:
        print(f"  gitlab_token: ***{token[-4:]}")
    else:
        print(f"  gitlab_token: {token or 'None'}")

    if not dry_run:
        config_repo.update_settings(**gitlab_update)

    # Step 4: Summary
    print("\n--- Migration Complete ---")
    if not dry_run:
        backup_path = f"{toml_path}.backup.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        print(f"\nMigration successful!")
        print(f"\nRecommendation: Rename original TOML file to preserve backup:")
        print(f"  mv {toml_path} {backup_path}")
        print("\nOr delete if confident:")
        print(f"  rm {toml_path}")
    else:
        print("\nDry run complete. Run without --dry-run to apply changes.")

    return True


def create_default_config(dry_run: bool = False) -> bool:
    """Create default configuration in SQLite"""
    print("Creating default configuration...")

    db = get_db()
    config_repo = ConfigRepository(db)
    provider_repo = LLMProviderRepository(db)

    # Create default providers
    default_providers = [
        ('openai', 'https://api.openai.com/v1', 'CHANGEME'),
        ('anthropic', None, 'CHANGEME'),
        ('custom', None, 'CHANGEME'),
    ]

    for name, base_url, api_key in default_providers:
        print(f"  Creating provider: {name}")
        if not dry_run:
            provider_repo.upsert(name, base_url, api_key)

    # Update default settings
    print("  Setting default configuration...")
    if not dry_run:
        config_repo.update_settings(
            active_provider='openai',
            active_model='gpt-4o-mini',
            gitlab_url='https://gitlab.example.com',
            default_prompt='你是一个代码审查专家。'
        )

    print("\nDefault configuration created.")
    return True


def verify_migration():
    """Verify migration was successful"""
    db = get_db()
    config_repo = ConfigRepository(db)
    provider_repo = LLMProviderRepository(db)

    print("\n=== Migration Verification ===\n")

    # Check settings
    settings = config_repo.get_settings()
    if settings:
        print("Current Settings:")
        for key, value in settings.items():
            if 'token' in key or 'key' in key:
                masked = '***' + str(value)[-4:] if value and len(str(value)) > 4 else str(value)
                print(f"  {key}: {masked}")
            elif key == 'default_prompt':
                preview = str(value)[:50] + "..." if value and len(str(value)) > 50 else str(value)
                print(f"  {key}: {preview}")
            else:
                print(f"  {key}: {value}")
    else:
        print("No settings found!")

    # Check providers
    print("\nConfigured Providers:")
    providers = provider_repo.find_all(limit=100)
    if providers:
        for p in providers:
            base_url = p.get('base_url') or 'default'
            print(f"  - {p['name']}: {base_url}")
    else:
        print("  No providers configured.")

    return True


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Migrate TOML config to SQLite")
    parser.add_argument("--dry-run", action="store_true", help="Preview migration without changes")
    parser.add_argument("--verify", action="store_true", help="Verify existing migration")
    parser.add_argument("--toml-path", type=str, help="Path to config.toml")

    args = parser.parse_args()

    try:
        if args.verify:
            verify_migration()
        else:
            migrate_toml_to_sqlite(toml_path=args.toml_path, dry_run=args.dry_run)
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
