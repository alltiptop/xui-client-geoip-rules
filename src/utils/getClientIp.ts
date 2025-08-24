export const getClientIp = (
  headers: Record<string, string | string[] | undefined>,
  ipFromFastify: string,
): string => {
  const forwarded = headers['x-forwarded-for'] as string | undefined;
  return forwarded ? forwarded.split(',')[0].trim() : ipFromFastify;
}
