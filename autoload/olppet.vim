function! olppet#config(arg) abort
  call s:string_to_list(a:arg, 'snippet')
  call s:string_to_list(a:arg, 'expand')
  call s:string_to_list(a:arg, 'jump_forward')
  call s:string_to_list(a:arg, 'jump_backward')
  call s:notify('config', [a:arg])
endfunction


function! olppet#loaded_snippet_file_paths() abort
  return denops#request('olppet', 'getLoadedFilePaths', [])
endfunction


function! s:string_to_list(arg, key) abort
  let l:value = get(a:arg, a:key, [])
  if type(l:value) == v:t_string
    let l:value = [l:value]
  elseif type(l:value) != v:t_list
    let l:value = []
  endif
  let a:arg[a:key] = l:value
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
