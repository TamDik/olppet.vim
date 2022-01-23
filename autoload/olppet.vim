let s:enabled = v:false


function! olppet#enable() abort
  if s:enabled
    return
  endif
  let s:enabled = v:true

  call s:notify('enable', [])
  augroup olppet
    autocmd!
    autocmd TextChangedI,TextChangedP * call s:request('textChanged', [], v:null)
    autocmd BufEnter * call s:notify('bufEntered', [])
  augroup END
endfunction


function! olppet#disable() abort
  if !s:enabled
    return
  endif
  let s:enabled = v:false

  call s:notify('disable', [])
  augroup olppet
    autocmd!
  augroup END
endfunction


function! olppet#register_snippet(name, type) abort
  call s:notify('registerSnippet', [a:name, a:type])
endfunction


function! olppet#expand() abort
  if !s:enabled
    return v:false
  endif
  return s:request('expand', [], v:false)
endfunction


function! olppet#jump_forward() abort
  if !s:enabled
    return v:false
  endif
  return s:request('jumpForward', [], v:false)
endfunction


function! olppet#jump_backward() abort
  if !s:enabled
    return v:false
  endif
  return s:request('jumpBackward', [], v:false)
endfunction


function! olppet#get_snippets(...) abort
  return s:request('getSnippets', [get(a:000, 0, &filetype)], v:false)
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
