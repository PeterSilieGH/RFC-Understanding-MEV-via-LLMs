// DIVERGENCE(mev): ADR-018 §1 exclusive edge-mode control. Replaces the two
// independent Control/Funds toggles with one segmented Default | Control | Funds
// selector — exactly one edge picture is visible at a time, all three sharing the
// same node layout (Default = the structural graph; Control/Funds = the overlay
// lanes). Colors carry meaning but are never the only channel.
import { IconSwap } from '../../../../icons/IconSwap'
import { IconTrace } from '../../../../icons/IconTrace'
import { cn } from '../../../../utils/cn'
import { FLOW_COLOR_HEX } from '../flow-overlay/flowColors'
import {
  type FlowOverlayLayer,
  type FlowOverlayMode,
  useFlowOverlayControls,
} from '../flow-overlay/FlowOverlayContext'
import { ControlButton } from './ControlButton'

export function FlowModeToggle() {
  const controls = useFlowOverlayControls()
  return (
    <span
      className="inline-flex self-stretch overflow-hidden rounded-lg"
      role="group"
      aria-label="Edge overlay mode"
    >
      <ModeButton mode="default" label="Default" />
      <ModeButton mode="control" label="Control" layer="control" />
      <ModeButton mode="funds" label="Funds" layer="funds" />
    </span>
  )

  function ModeButton(props: {
    mode: FlowOverlayMode
    label: string
    layer?: FlowOverlayLayer
  }) {
    const active = controls.mode === props.mode
    const disabledReason = props.layer
      ? controls.disabledReason(props.layer)
      : undefined
    const Icon = props.mode === 'funds' ? IconSwap : IconTrace
    return (
      <span
        className="inline-flex self-stretch"
        title={
          disabledReason ??
          (active
            ? `${props.label} edges shown`
            : `Show ${props.label.toLowerCase()} edges`)
        }
      >
        <ControlButton
          aria-pressed={active}
          aria-label={
            disabledReason
              ? `${props.label} edges unavailable: ${disabledReason}`
              : `${props.label} edges`
          }
          data-testid={`flow-mode-${props.mode}`}
          disabled={disabledReason !== undefined}
          onClick={() => controls.setMode(props.mode)}
          className={cn(
            'h-full gap-2 rounded-none border-x-0 px-3 py-2.5 font-medium text-sm leading-none',
            active && 'bg-coffee-700 text-coffee-100',
          )}
        >
          <span
            aria-hidden
            className="inline-block size-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: FLOW_COLOR_HEX[props.mode] }}
          />
          {props.mode === 'default' ? null : <Icon className="size-4 shrink-0" />}
          <span>{props.label}</span>
        </ControlButton>
      </span>
    )
  }
}
