" Copyright 2014 Bill Heughan, all rights reserved

" adding pathogen to vimrc
call pathogen#infect()
call pathogen#helptags()

" no compatibility with vi
set nocompatible
syntax enable
set encoding=utf-8
set showcmd
filetype plugin indent on

set nowrap
set tabstop=4 shiftwidth=4
set expandtab
set backspace=indent,eol,start

"" Searching

set hlsearch
set incsearch
set ignorecase
set smartcase

"" Mappings
nmap <F2> :NERDTreeToggle<CR>
nmap <F3> :GundoToggle<CR>
nmap <F4> :Gcommit <CR>

"" Mapping
let mapleader = ","

"" Color Scheme
colorscheme tomorrow_night

" Always show the statusline
set laststatus=2

" Enable fancy mode
let g:Powerline_symbols = 'fancy'

set relativenumber
set colorcolumn=81
set cursorline
