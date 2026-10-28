import type { Register } from 'claude-code'

import { registerGroup } from './group'
import { registerMessages } from './messages'
import { registerRows } from './rows'

export const register: Register = (on, options) => {
  registerMessages(on, options)
  registerRows(on, options)
  registerGroup(on, options)
}
