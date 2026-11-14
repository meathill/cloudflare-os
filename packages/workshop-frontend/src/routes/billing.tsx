import { createFileRoute } from '@tanstack/react-router'
import BillingPage from '../pages/billing/BillingPage'

type BillingSearch = { topup?: 'success' | 'cancelled' }

const BillingRoute = () => <BillingPage topup={Route.useSearch().topup} />

export const Route = createFileRoute('/billing')({
  component: BillingRoute,
  validateSearch: (search: Record<string, unknown>): BillingSearch => ({
    topup: search.topup === 'success' || search.topup === 'cancelled' ? search.topup : undefined,
  }),
})
