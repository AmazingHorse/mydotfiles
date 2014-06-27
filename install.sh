#!/usr/bin/env bash

echo "Checking if git is installed"
command -v git >/dev/null 2>&1 || { echo >&2 "git is not installed...aborting."; exit 1; }

echo "Initializing submodules..."
git submodule init
git submodule update

echo "Deleting the old files..."
rm ~/.vimrc
rm ~/.vim

echo "Symlinking files..."
ln -s ~/mydotfiles/vimrc ~/.vimrc
ln -s ~/mydotfiles/vim ~/.vim

echo "Updating Submodules..."
git submodule foreach git pull origin master --recurse-submodules

echo "All done.

