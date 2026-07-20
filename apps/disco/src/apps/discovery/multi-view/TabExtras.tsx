import { useParams } from 'react-router-dom'
import { IconChatbot } from '../../../icons/IconChatbot'
import { findSelected } from '../../../utils/findSelected'
import { getProjectQueryOptions } from '../hooks/projectQuery'
import { usePanelStore } from '../store/panel-store'
import {
  formatContractAbi,
  formatContractCode,
  formatContractValues,
} from '../utils/panelContext'
import type { PanelId } from './config'

const COPYABLE_PANELS: PanelId[] = ['code', 'values', 'list', 'nodes']

export function TabExtras(props: { id: PanelId }) {
  const { project } = useParams()
  const selectedAddress = usePanelStore((state) => state.selected)
  const highlighted = usePanelStore((state) => state.highlighted)

  if (!COPYABLE_PANELS.includes(props.id)) {
    return null
  }

  return (
    <button
      type="button"
      className="w-4 text-coffee-200 hover:text-coffee-100"
      onClick={() =>
        toClipboard(props.id, project, selectedAddress, highlighted)
      }
      aria-label="Copy panel context"
    >
      <IconChatbot />
    </button>
  )
}

async function toClipboard(
  panel: PanelId,
  project: string | undefined,
  selectedAddress: string | undefined,
  highlighted: readonly string[],
) {
  if (!project) {
    throw new Error('Cannot use component outside of project page!')
  }
  if (!COPYABLE_PANELS.includes(panel)) return

  let message: string[] = []
  switch (panel) {
    case 'code': {
      message = await formatContractCode(project, selectedAddress)
      break
    }
    case 'values': {
      const projectData = await getProjectQueryOptions(project).queryFn()
      const contract = findSelected(projectData.entries, selectedAddress)
      if (!contract) break
      const fields = formatContractValues(contract, contract.blockNumber)
      const abis = formatContractAbi(contract)
      message = [...fields, ...abis]
      break
    }
    case 'list': {
      const projectData = await getProjectQueryOptions(project).queryFn()
      for (const chain of projectData.entries) {
        const contracts = [
          ...chain.initialContracts,
          ...chain.discoveredContracts,
        ]
        for (const contract of contracts) {
          const code = await formatContractCode(
            project,
            contract.address,
            contract.name,
          )
          const values = formatContractValues(
            contract,
            chain.blockNumbers[contract.chain],
          )
          const abi = formatContractAbi(contract)
          message.push(...code, ...values, ...abi)
        }
      }
      break
    }
    case 'nodes': {
      const projectData = await getProjectQueryOptions(project).queryFn()
      for (const chain of projectData.entries) {
        const contracts = [
          ...chain.initialContracts,
          ...chain.discoveredContracts,
        ].filter((c) => highlighted.includes(c.address))
        for (const contract of contracts) {
          const code = await formatContractCode(
            project,
            contract.address,
            contract.name,
          )
          const values = formatContractValues(
            contract,
            chain.blockNumbers[contract.chain],
          )
          const abi = formatContractAbi(contract)
          message.push(...code, ...values, ...abi)
        }
      }
      break
    }
  }

  navigator.clipboard.writeText(message.join('\n'))
}
