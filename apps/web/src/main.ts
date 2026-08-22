import { mount } from 'svelte'
import '@glyphsmith/ui/lib/theme.css'
import Root from './Root.svelte'

mount(Root, { target: document.getElementById('app')! })
