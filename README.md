# olppet.vim

Olppet is the snippets engine for neovim/Vim8

## Requirements

This plugin requires [denops.vim](https://github.com/vim-denops/denops.vim).


## Configuration

```vim
Plugin 'TamDik/olppet.vim'
Plugin 'honza/vim-snippets'

call olppet#register_snippets(['honza/vim-snippets'])

imap <tab> <Plug>(olppet-expand)
imap <C-b> <Plug>(olppet-jump-forward)
imap <C-z> <Plug>(olppet-jump-backward)
```
