from events.providers.base import BaseProvider
from events.providers.taiwan import TaiwanProvider

# Mapping from country code to provider instance.
# Add new countries here without extra factories.
PROVIDERS: dict[str, BaseProvider] = {
    "tw": TaiwanProvider(),
}
