export async function retryOnceAfterAuthFailure<T, S>({
  session,
  operation,
  renew,
  isAuthorizationError,
}: {
  session: S;
  operation: (session: S) => Promise<T>;
  renew: () => Promise<S>;
  isAuthorizationError: (error: unknown) => boolean;
}) {
  try {
    return { session, value: await operation(session), renewed: false as const };
  } catch (error) {
    if (!isAuthorizationError(error)) throw error;
    const renewedSession = await renew();
    return { session: renewedSession, value: await operation(renewedSession), renewed: true as const };
  }
}
