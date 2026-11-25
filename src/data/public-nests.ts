// Nests we run that anyone can query, listed under Hosted on /nests. Each is the stock binary, read-only
// behind a proxy: queries only (GET, plus POST to /sql and /mcp), no admin, so nobody can add accounts at the operator's cost.
// An endpoint is this site's own /nests/<id>, which vercel.json rewrites to the box that runs it,
// so a new entry needs its rewrite too.
export interface PublicNest {
  id: string;
  name: string;
  chain: string;
  /** Who it was stood up for, and where they asked. */
  for: { label: string; href: string };
  summary: string;
  endpoint: string;
  /** A query that answers with rows today. */
  example: string;
}

export const publicNests: PublicNest[] = [
  {
    id: 'bounty-nest',
    name: 'Lodestar sync bounties',
    chain: 'arbitrum-one',
    for: { label: 'Lodestar', href: 'https://www.lodestar-dashboard.com/bounties' },
    summary:
      'Every bounty posted on BountyBoard 2.0.0 and what became of it, so an indexer can poll for open ones. SQL at /sql, views bounties and open_bounties.',
    endpoint: 'https://nuthatch-indexer.com/nests/bounty-nest',
    example:
      "curl 'https://nuthatch-indexer.com/nests/bounty-nest/sql?q=SELECT%20*%20FROM%20open_bounties'",
  },
  {
    id: 'irmarket',
    name: 'IRMarket',
    chain: 'monad-testnet',
    for: { label: 'dixia/IRMarket', href: 'https://github.com/dixia/IRMarket/issues/1' },
    summary:
      'IRMarket and Monoracle events from deployment, following the tip every 2 seconds, with a positions view per wallet. SQL at /sql.',
    endpoint: 'https://nuthatch-indexer.com/nests/irmarket',
    example:
      "curl 'https://nuthatch-indexer.com/nests/irmarket/sql?q=SELECT%20*%20FROM%20irmarket__market_created%20LIMIT%205'",
  },
  {
    id: 'rotki-demo',
    name: 'rotki demo',
    chain: 'ethereum',
    for: { label: 'rotki', href: '/rotki' },
    summary:
      'Address history for one account, vitalik.eth, in the Etherscan-shaped /api rotki reads: transactions, internal transactions and token transfers.',
    endpoint: 'https://nuthatch-indexer.com/nests/rotki-demo',
    example:
      "curl 'https://nuthatch-indexer.com/nests/rotki-demo/api?module=account&action=tokentx&address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&startblock=24000000&endblock=24100000&page=1&offset=10'",
  },
  {
    id: 'base-history',
    name: 'Base address history',
    chain: 'base',
    for: { label: 'agntn/explorers', href: 'https://github.com/agntn/explorers/issues/253' },
    summary:
      'One active account in the Etherscan-shaped /api, keyless: its balance, transactions, internal transactions and token transfers on Base.',
    endpoint: 'https://nuthatch-indexer.com/nests/base-history',
    example:
      "curl 'https://nuthatch-indexer.com/nests/base-history/api?module=account&action=balance&address=0x342d8f4fa18008495879d29f9ea93d28afb74d2f'",
  },
  {
    id: 'gnosis-history',
    name: 'RealT wallet on Gnosis',
    chain: 'gnosis',
    for: { label: 'VISIALIS/alter', href: 'https://github.com/VISIALIS/alter/issues/168' },
    summary:
      'Every token transfer of one RealT wallet, about 525,000 of them, in the Etherscan-shaped tokentx. The wallet is a contract, so its plain transactions are refused rather than guessed.',
    endpoint: 'https://nuthatch-indexer.com/nests/gnosis-history',
    example:
      "curl 'https://nuthatch-indexer.com/nests/gnosis-history/api?module=account&action=tokentx&address=0x10497611ee6524d75fc45e3739f472f83e282ad5&startblock=32100000&endblock=48900000&page=1&offset=10'",
  },
  {
    id: 'base-usdc',
    name: 'Base USDC',
    chain: 'base',
    for: { label: 'anyone trying Nuthatch', href: '/docs/ai/mcp' },
    summary:
      "Every Circle USDC event on Base for the seven days before 19 November 2026 and everything since, about 28 million transfers at the time of writing, following the tip. Not all of Base's history. SQL at /sql and MCP over HTTP at /mcp, with a balances view per holder.",
    endpoint: 'https://nuthatch-indexer.com/nests/base-usdc',
    example:
      "curl -sG 'https://nuthatch-indexer.com/nests/base-usdc/sql' --data-urlencode 'q=SELECT count(*) FROM usdc__transfer'",
  },
  {
    id: 'arc-usdc',
    name: 'Arc testnet USDC',
    chain: 'arc-testnet',
    for: { label: 'anyone trying Nuthatch', href: '/docs/ai/mcp' },
    summary:
      "USDC on Circle's Arc testnet from block 72,550,000, the native-token Transfer and every other USDC event, following the tip every 2 seconds. SQL at /sql and MCP over HTTP at /mcp, with a balances view per holder.",
    endpoint: 'https://nuthatch-indexer.com/nests/arc-usdc',
    example:
      "curl -sG 'https://nuthatch-indexer.com/nests/arc-usdc/sql' --data-urlencode 'q=SELECT count(*) FROM usdc__transfer'",
  },
  {
    id: 'gooddollar-xdc',
    name: 'GoodDollar UBI on XDC',
    chain: 'xdc',
    for: { label: 'GoodDollar', href: '/showcase/?nest=gooddollar-xdc' },
    summary:
      'Every UBIScheme event on XDC from block 95,249,624, about 3.9 million UBIClaimed rows from 78,000 claimers, indexed from a public RPC with no HyperSync, following the tip. SQL at /sql and MCP over HTTP at /mcp. The history is still backfilling when this entry goes live.',
    endpoint: 'https://nuthatch-indexer.com/nests/gooddollar-xdc',
    example:
      "curl -sG 'https://nuthatch-indexer.com/nests/gooddollar-xdc/sql' --data-urlencode 'q=SELECT count(DISTINCT claimer) FROM ubi_scheme__u_b_i_claimed'",
  },
  {
    id: 'sablier-xdc',
    name: 'Sablier on XDC',
    chain: 'xdc',
    for: { label: 'Sablier', href: '/showcase/?nest=sablier-xdc' },
    summary:
      'Sablier Lockup, Flow and Airdrops on XDC from the first deployment at block 85,225,620 as event tables, about 500 events across 14 contracts and their airdrop campaigns, following the tip. Events only: the Stream, Action and Campaign entities are not built. SQL at /sql and MCP over HTTP at /mcp.',
    endpoint: 'https://nuthatch-indexer.com/nests/sablier-xdc',
    example:
      "curl -sG 'https://nuthatch-indexer.com/nests/sablier-xdc/sql' --data-urlencode 'q=SELECT count(*) FROM lockup_v2_0__create_lockup_linear_stream'",
  },
  {
    id: 'pharos-eth',
    name: 'LP token holders on Ethereum',
    chain: 'ethereum',
    for: { label: 'pharos-watch', href: '/showcase/?nest=pharos-eth' },
    summary:
      'Every Transfer of two liquidity-pool tokens, LUSD3CRV and the Uniswap V2 USDC/USDT pair, about 109,000 rows since launch, so holders and supply can be replayed in SQL. Block times are not stored. SQL at /sql and MCP over HTTP at /mcp.',
    endpoint: 'https://nuthatch-indexer.com/nests/pharos-eth',
    example:
      "curl -sG 'https://nuthatch-indexer.com/nests/pharos-eth/sql' --data-urlencode 'q=SELECT count(*) FROM lusd3crv__transfer'",
  },
  {
    id: 'beefy-hyperevm',
    name: 'Beefy vaults on HyperEVM',
    chain: 'hyperevm',
    for: { label: 'Beefy', href: '/showcase/?nest=beefy-hyperevm' },
    summary:
      'Every vault, reward pool and CLM manager the three Beefy factories on HyperEVM have created, discovered from the factories and indexed from the block each was made, about 40,000 events with their transfers, deposits, withdrawals and stakes, following the tip. Block times are not stored. SQL at /sql and MCP over HTTP at /mcp.',
    endpoint: 'https://nuthatch-indexer.com/nests/beefy-hyperevm',
    example:
      "curl -sG 'https://nuthatch-indexer.com/nests/beefy-hyperevm/sql' --data-urlencode 'q=SELECT count(*) FROM clm_manager__deposit'",
  },
  {
    id: 'mpamm-monad',
    name: 'Capricorn and Metric pools on Monad',
    chain: 'monad',
    for: { label: 'mpamm', href: '/showcase/?nest=mpamm-monad' },
    summary:
      'Every pool the Capricorn and Metric v1 factories have created on Monad and every swap in them since the Capricorn factory was deployed, about 25,000 events, following the tip. SQL at /sql and MCP over HTTP at /mcp.',
    endpoint: 'https://nuthatch-indexer.com/nests/mpamm-monad',
    example:
      "curl -sG 'https://nuthatch-indexer.com/nests/mpamm-monad/sql' --data-urlencode 'q=SELECT count(*) FROM capricorn_pool__swap'",
  },
  {
    id: 'spendshield-aevum',
    name: 'SpendShield on Aevum testnet',
    chain: 'aevum-testnet',
    for: { label: 'SpendShield', href: '/showcase/?nest=spendshield-aevum' },
    summary:
      'Every event the SpendShield contract has emitted on Aevum testnet since block 3581556: agent payments, owner policy changes, deposits, withdrawals and approval requests, 92 events so far, following the tip. SQL at /sql and MCP over HTTP at /mcp.',
    endpoint: 'https://nuthatch-indexer.com/nests/spendshield-aevum',
    example:
      "curl -sG 'https://nuthatch-indexer.com/nests/spendshield-aevum/sql' --data-urlencode 'q=SELECT count(*) FROM spend_shield__agent_paid'",
  },
  {
    id: 'ens-registrar',
    name: 'ENS registrations on Ethereum',
    chain: 'ethereum',
    for: { label: 'the launch demo', href: '/showcase/?nest=ens-registrar' },
    summary:
      'Every .eth registration and renewal on Ethereum mainnet: the ENS v1 ETHRegistrarController from block 16,925,618 (March 2023) and the ENSv2 ETHRegistrar from block 26,183,999, about 1.5 million events with a registrations view over both, following the tip. SQL at /sql and MCP over HTTP at /mcp.',
    endpoint: 'https://nuthatch-indexer.com/nests/ens-registrar',
    example:
      "curl -sG 'https://nuthatch-indexer.com/nests/ens-registrar/sql' --data-urlencode 'q=SELECT count(*) FROM registrations'",
  },
];
