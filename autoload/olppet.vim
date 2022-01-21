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
    autocmd FileType * call s:notify('fileTypeChanged', [])
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


function! olppet#register_snippets(names) abort
  let l:names = s:string_to_list(a:names)
  call s:notify('registerSnippets', [l:names])
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
