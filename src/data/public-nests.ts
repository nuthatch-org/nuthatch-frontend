// Nests we run that anyone can query, listed under Hosted on /nests. Each is the stock binary, read-only
// behind a proxy: GET only, no admin, so nobody can add accounts at the operator's cost.
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
    id: 'irmarket',
    name: 'IRMarket',
    chain: 'monad-testnet',
    for: { label: 'dixia/IRMarket', href: 'https://github.com/dixia/IRMarket/issues/1' },
    summary:
      'IRMarket and Monoracle events from deployment, following the tip every 2 seconds, with a positions view per wallet. SQL at /sql.',
    endpoint: 'https://irmarket.89.167.109.4.sslip.io',
    example:
      "curl 'https://irmarket.89.167.109.4.sslip.io/sql?q=SELECT%20*%20FROM%20irmarket__market_created%20LIMIT%205'",
  },
  {
    id: 'rotki-demo',
    name: 'rotki demo',
    chain: 'ethereum',
    for: { label: 'rotki', href: '/rotki' },
    summary:
      'Address history for one account, vitalik.eth, in the Etherscan-shaped /api rotki reads: transactions, internal transactions and token transfers.',
    endpoint: 'https://rotki.nuthatch-indexer.com',
    example:
      "curl 'https://rotki.nuthatch-indexer.com/api?module=account&action=tokentx&address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&startblock=24000000&endblock=24100000&page=1&offset=10'",
  },
  {
    id: 'bsc-history',
    name: 'BSC address history',
    chain: 'bsc',
    for: { label: 'PavelArs/capital-tracker', href: 'https://github.com/PavelArs/capital-tracker/pull/354' },
    summary:
      'One active account from genesis in the Etherscan-shaped /api, where Etherscan’s free plan no longer serves BNB Smart Chain: transactions, internal transactions, token transfers and its balance.',
    endpoint: 'https://bsc-history.89.167.109.4.sslip.io',
    example:
      "curl 'https://bsc-history.89.167.109.4.sslip.io/api?module=account&action=txlist&address=0x1aaf53fdf0c3d5cb3721970850ddc9dfe398690d&startblock=0&endblock=129000000&page=1&offset=10'",
  },
  {
    id: 'base-history',
    name: 'Base address history',
    chain: 'base',
    for: { label: 'agntn/explorers', href: 'https://github.com/agntn/explorers/issues/253' },
    summary:
      'One active account in the Etherscan-shaped /api, keyless: its balance, transactions, internal transactions and token transfers on Base.',
    endpoint: 'https://base-history.89.167.109.4.sslip.io',
    example:
      "curl 'https://base-history.89.167.109.4.sslip.io/api?module=account&action=balance&address=0x342d8f4fa18008495879d29f9ea93d28afb74d2f'",
  },
  {
    id: 'gnosis-history',
    name: 'RealT wallet on Gnosis',
    chain: 'gnosis',
    for: { label: 'VISIALIS/alter', href: 'https://github.com/VISIALIS/alter/issues/168' },
    summary:
      'Every token transfer of one RealT wallet, about 525,000 of them, in the Etherscan-shaped tokentx. The wallet is a contract, so its plain transactions are refused rather than guessed.',
    endpoint: 'https://gnosis-history.89.167.109.4.sslip.io',
    example:
      "curl 'https://gnosis-history.89.167.109.4.sslip.io/api?module=account&action=tokentx&address=0x10497611ee6524d75fc45e3739f472f83e282ad5&startblock=32100000&endblock=48900000&page=1&offset=10'",
  },
];
