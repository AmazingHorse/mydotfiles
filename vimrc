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
set background=dark

" Always show the statusline
set laststatus=2

set relativenumber
set colorcolumn=81
set cursorline

" Powerline stuff
set rtp+=$HOME/.local/lib/python2.7/site-packages/powerline/bindings/vim/

" Always show statusline
set laststatus=2

" Use 256 colours (Use this setting only if your terminal supports 256 colours)
set t_Co=256
