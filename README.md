# olppet.vim

Olppet is the snippets engine for neovim/Vim8

## Requirements

This plugin requires [denops.vim](https://github.com/vim-denops/denops.vim).


## Configuration

```vim
Plug 'TamDik/olppet.vim'
Plug 'vim-denops/denops.vim'
Plug 'honza/vim-snippets'

imap <tab> <Plug>(olppet-expand)
imap <C-f> <Plug>(olppet-jump-forward)
imap <C-b> <Plug>(olppet-jump-backward)

call olppet#register_snippet('honza/vim-snippets', 'SnipMate', 'snippets')
call olppet#register_snippet('/path/to/snippets/directory', 'VSCode')
call olppet#enable()
```
