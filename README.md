# olppet.vim

Olppet is the snippets engine for neovim/Vim8

## Requirements

This plugin requires [denops.vim](https://github.com/vim-denops/denops.vim).


## Configuration

```vim
call olppet#config({
    \ 'snippet': ['honza/vim-snippets'],
    \ 'expand': '<Tab>',
    \ 'jump_forward': '<C-f>',
    \ 'jump_backward': '<C-b>',
    \ })
```
