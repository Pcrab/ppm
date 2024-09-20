if exists ('g:loaded_pmm')
	finish
endif
let g:loaded_pmm = 1

augroup ppm
	autocmd!
	autocmd User DenopsPluginPost:ppm
		\ call denops#notify('ppm', 'init', [])
augroup END
