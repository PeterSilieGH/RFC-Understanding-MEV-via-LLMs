// DIVERGENCE(mev): ADR-016 route-aware semantic overlay controls.
import { IconSwap } from '../../../../icons/IconSwap'
import { IconTrace } from '../../../../icons/IconTrace'
import { cn } from '../../../../utils/cn'
import {
  type FlowOverlayLayer,
  useFlowOverlayControls,
} from '../flow-overlay/FlowOverlayContext'
import { ControlButton } from './ControlButton'

export function FlowToggleButton(props: { layer: FlowOverlayLayer }) {
  const controls = useFlowOverlayControls()
  const pressed = controls[props.layer]
  const disabledReason = controls.disabledReason(props.layer)
  const label = props.layer === 'control' ? 'Control' : 'Funds'
  const Icon = props.layer === 'control' ? IconTrace : IconSwap
  return (
    <span
      className="inline-flex self-stretch"
      title={
        disabledReason ??
        `${pressed ? 'Hide' : 'Show'} ${label.toLowerCase()} flow`
      }
    >
      <ControlButton
        aria-pressed={pressed}
        aria-label={
          disabledReason
            ? `${label} flow overlay unavailable: ${disabledReason}`
            : `${label} flow overlay`
        }
        data-testid={`${props.layer}-flow-toggle`}
        disabled={disabledReason !== undefined}
        onClick={() => controls.toggle(props.layer)}
        className={cn(
          'h-full gap-2 px-3 py-2.5 font-medium text-sm leading-none',
          pressed && 'border-autumn-300 bg-coffee-700 text-autumn-300',
        )}
      >
        <Icon className="size-4 shrink-0" />
        <span>{label}</span>
      </ControlButton>
    </span>
  )
}
