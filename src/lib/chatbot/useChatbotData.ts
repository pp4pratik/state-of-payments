import {
  useMonthlyTrend,
  useAppStatsAll,
  useP2pAll,
  useMerchantCategoriesAll,
  useStatewiseAll,
  useAutoPayRegistrations,
  useAutoPayExecutions,
  useAutoPayRegistrationsByBank,
  useAutoPayExecutionsByPsp,
  usePspMemberPerformance,
  useRbiCardsAll,
  useRbiPaymentsAll,
  useCirculars,
} from '../queries'
import type { ChatbotData } from './engine'

// Bundles every dataset the chatbot can reason over. Every one of these hooks is
// already fetched elsewhere in the dashboard (Dashboard/UpiView/AutoPayView/etc.),
// so TanStack Query serves this from cache rather than re-fetching - mounting the
// chat widget anywhere in the dashboard tree is effectively free.
export function useChatbotData(): { isReady: boolean; data: ChatbotData | null } {
  const monthlyTrend = useMonthlyTrend()
  const appStats = useAppStatsAll()
  const p2p = useP2pAll()
  const merchantCategories = useMerchantCategoriesAll()
  const statewise = useStatewiseAll()
  const autoPayRegistrations = useAutoPayRegistrations()
  const autoPayExecutions = useAutoPayExecutions()
  const autoPayRegistrationsByBank = useAutoPayRegistrationsByBank()
  const autoPayExecutionsByPsp = useAutoPayExecutionsByPsp()
  const pspMemberPerformance = usePspMemberPerformance()
  const rbiCards = useRbiCardsAll()
  const rbiPayments = useRbiPaymentsAll()
  const circulars = useCirculars()

  const queries = [
    monthlyTrend, appStats, p2p, merchantCategories, statewise,
    autoPayRegistrations, autoPayExecutions, autoPayRegistrationsByBank, autoPayExecutionsByPsp,
    pspMemberPerformance, rbiCards, rbiPayments, circulars,
  ]
  const isReady = queries.every((q) => q.data !== undefined)
  if (!isReady) return { isReady: false, data: null }

  return {
    isReady: true,
    data: {
      monthlyTrend: monthlyTrend.data!,
      appStats: appStats.data!,
      p2p: p2p.data!,
      merchantCategories: merchantCategories.data!,
      statewise: statewise.data!,
      autoPayRegistrations: autoPayRegistrations.data!,
      autoPayExecutions: autoPayExecutions.data!,
      autoPayRegistrationsByBank: autoPayRegistrationsByBank.data!,
      autoPayExecutionsByPsp: autoPayExecutionsByPsp.data!,
      pspMemberPerformance: pspMemberPerformance.data!,
      rbiCards: rbiCards.data!,
      rbiPayments: rbiPayments.data!,
      circulars: circulars.data!,
    },
  }
}
