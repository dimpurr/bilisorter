import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'BiliSorter - AI收藏夹整理',
    description: '使用AI智能整理Bilibili收藏夹，一键分类、批量移动',
    version: '0.1.0',
    permissions: ['cookies', 'storage'],
    host_permissions: ['*://*.bilibili.com/*', 'https://api.bilibili.com/*', 'https://api.anthropic.com/*', 'https://generativelanguage.googleapis.com/*'],
    icons: {
      '16': 'icon/16.png',
      '32': 'icon/32.png',
      '48': 'icon/48.png',
      '128': 'icon/128.png',
    },
  },
  runner: {
    disabled: true
  }
});
