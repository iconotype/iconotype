import { mount } from 'svelte'
import '@iconotype/ui/lib/theme.css'
import '@iconotype/ui/lib/theme-vscode.css'
import Root from './Root.svelte'

mount(Root, { target: document.getElementById('app')! })
