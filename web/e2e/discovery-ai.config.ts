import {defineConfig} from '@playwright/test';
import base from './institution-entry.config';
export default defineConfig({...base,testMatch:'discovery-ai.browser.ts'});
