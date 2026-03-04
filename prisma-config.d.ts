declare module 'prisma/config' {
  export function defineConfig<T extends Record<string, unknown>>(config: T): T;
  export function env(name: string): string;
}

