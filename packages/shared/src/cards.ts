export interface CardIngestStatus {
  cardCount: number;
  latest: {
    id: string;
    status: 'running' | 'success' | 'failed';
    bulkUpdatedAt: string | null;
    processed: number;
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
  } | null;
}
