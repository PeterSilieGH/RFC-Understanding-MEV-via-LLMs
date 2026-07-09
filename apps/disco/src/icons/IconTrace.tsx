import { Icon } from './Icon'

export function IconTrace(props: { className?: string }) {
  return (
    <Icon
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M7 6h10" />
      <path d="M12 6v9a3 3 0 0 0 3 3h2" />
    </Icon>
  )
}
