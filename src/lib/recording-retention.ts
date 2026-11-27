export const RECORDING_RETENTION_DAYS = 60;
export const recordingRetainsUntil = (createdAt:string) => new Date(Date.parse(createdAt) + RECORDING_RETENTION_DAYS * 86400000).toISOString();
