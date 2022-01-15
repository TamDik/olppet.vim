function! olppet#register_snippets(snippets) abort
  let l:snippets = s:string_to_list(a:snippets)
  call s:notify('registerSnippets', [l:snippets])
endfunction


function! olppet#expand() abort
  return s:request('expand', [], v:false)
endfunction


function! olppet#jump_forward() abort
  return s:request('jumpForward', [], v:false)
endfunction


function! olppet#jump_backward() abort
  return s:request('jumpBackward', [], v:false)
endfunction


function! s:string_to_list(arg) abort
  if type(a:arg) == v:t_list
    return a:arg
  else
    return [a:arg]
  endif
endfunction


function! s:denops_running() abort
  try
    return denops#server#status() ==# 'running' && denops#plugin#is_loaded('olppet')
  catch
    return v:false
  endtry
endfunction


function! s:notify(method, args) abort
  if s:denops_running()
    call denops#notify('olppet', a:method, a:args)
  else
    execute printf('autocmd User OlppetReady call denops#notify("olppet", "%s", %s)', a:method, string(a:args))
  endif
endfunction


function! s:request(method, args, failed) abort
  if s:denops_running()
    return denops#request('olppet', a:method, a:args)
  else
    return a:failed
  endif
endfunction
