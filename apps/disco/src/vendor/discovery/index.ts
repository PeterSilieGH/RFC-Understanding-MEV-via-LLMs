export {
  ContractConfigSchema,
  DiscoveryConfigSchema,
  FieldConfigSchema,
} from './schemas'

// Extracted from upstream discovery/analysis/TemplateService.ts - the class
// itself is a node/fs module the browser build can't import.
export type RefreshReason =
  | {
      type: 'TEMPLATE_NO_LONGER_MATCHES'
      contract: string
      template: string
    }
  | {
      type: 'TEMPLATE_MATCH_CHANGED'
      contract: string
      oldTemplate: string
      newTemplates: string[]
    }
  | {
      type: 'NEW_TEMPLATE_MATCH'
      contract: string
      newTemplates: string[]
    }
  | {
      type: 'CONFIG_CHANGED'
    }
  | {
      type: 'TEMPLATE_CONFIG_CHANGED'
      templates: string[]
    }
