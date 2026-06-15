import * as Sentry from '@sentry/react-native';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

export function initSentry() {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    debug: false,
    environment: process.env.EXPO_PUBLIC_ENV ?? 'development',
    tracesSampleRate: 0.2,
    enabled: !!DSN,
  });
}

export const captureException = (err: unknown) => {
  if (DSN) Sentry.captureException(err);
};

export const captureMessage = (msg: string) => {
  if (DSN) Sentry.captureMessage(msg);
};
