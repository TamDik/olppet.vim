if exists('g:loaded_olppet') && g:loaded_olppet
  finish
endif
let g:loaded_olppet = v:true

noremap! <Plug>(olppet-expand) <Cmd>call olppet#expand()<CR>
noremap! <Plug>(olppet-jump-forward) <Cmd>call olppet#jump_forward()<CR>
noremap! <Plug>(olppet-jump-backward) <Cmd>call olppet#jump_backward()<CR>
