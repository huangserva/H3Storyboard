import type { H3ProviderName } from '@h3storyboard/protocol';
import type { H3ProviderAdapter } from './provider.js';

export class ProviderRegistryError extends Error {
  constructor(
    readonly code: 'PROVIDER_ALREADY_REGISTERED' | 'PROVIDER_NOT_REGISTERED',
    message: string,
  ) {
    super(message);
    this.name = 'ProviderRegistryError';
  }
}

export class ProviderRegistry {
  readonly #providers = new Map<H3ProviderName, H3ProviderAdapter>();

  register(provider: H3ProviderAdapter): void {
    if (this.#providers.has(provider.name)) {
      throw new ProviderRegistryError(
        'PROVIDER_ALREADY_REGISTERED',
        `Provider ${provider.name} is already registered`,
      );
    }
    this.#providers.set(provider.name, provider);
  }

  get(name: H3ProviderName): H3ProviderAdapter {
    const provider = this.#providers.get(name);
    if (!provider) {
      throw new ProviderRegistryError(
        'PROVIDER_NOT_REGISTERED',
        `Provider ${name} is not registered`,
      );
    }
    return provider;
  }
}
