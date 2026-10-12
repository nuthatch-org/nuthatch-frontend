// Stopgap nests: subgraphs The Graph network does not serve, answered from a nuthatch nest until an
// indexer allocates. One entry per deployment; the page at /subgraphs/<deployment> is built from it.
export interface Example { title: string; query: string; variables?: string }
export interface Stopgap {
  deployment: string;
  name: string;
  coverage: string;
  repository: string;
  chain: string;
  since: string;
  lastActivity: string;
  record: string;
  entities: string[];
  refused: { field: string; why: string }[];
  examples: Example[];
}

export const ENDPOINT_BASE = 'https://subgraphs.nuthatch-indexer.com/subgraphs/id/';

export const stopgaps: Stopgap[] = [{
  deployment: 'QmbzwJnre963f9wT9VCJPede69vaniAKWVHzUEsAmBfrHG',
  name: 'OX AI PRO event history',
  coverage: 'A limited event-history fallback. It does not restore the dashboard: member balances, referral totals and monthly eligibility calculations remain unavailable.',
  repository: 'https://github.com/nuthatch-org/ox-ai-pro-nest',
  chain: 'Polygon',
  since: '2026-10-12',
  lastActivity: 'Following current contract events',
  record: 'https://github.com/nuthatch-org/graph-support/issues/57',
  entities: ['SubscriptionEvent', 'Reward', 'RankUpEvent', 'CampaignWin', 'MonthSnapshotEntity', 'Transfer', 'Withdrawal', 'Deposit'],
  refused: [
    { field: 'Global.*', why: 'global counters have not been ported' },
    { field: 'Member fields other than id and supported event relations', why: 'profiles, balances, ranks and referral totals have not been ported; Member.id is available for event relations' },
    { field: 'DirectorReward.*', why: 'accumulated director eligibility and claim state have not been ported' },
    { field: 'MemberMonthVolume.*', why: 'monthly referral-tree volume calculations have not been ported' },
  ],
  examples: [
    { title: 'Recent subscriptions', query: '{ _meta { block { number timestamp } } subscriptionEvents(first: 20, orderBy: block, orderDirection: desc) { id member { id } amount currency firstSub sponsorId timestamp block txHash } }' },
    { title: 'Recent rewards', query: '{ rewards(first: 20, orderBy: timestamp, orderDirection: desc) { id upline { id } fromUserId pb pc timestamp txHash } }' },
    { title: 'Withdrawals', query: '{ withdrawals(first: 20, orderBy: block, orderDirection: desc) { id member { id } userId asset kind to amount usdtOut tokenOut timestamp block txHash } }' },
    { title: 'Deposits', query: '{ deposits(first: 20, orderBy: block, orderDirection: desc) { id from amount message timestamp block txHash } }' },
  ],
}];
