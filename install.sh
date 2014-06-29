#!/usr/bin/env bash

echo "Checking if git is installed"
command -v git >/dev/null 2>&1 || \
{ echo -e >&2 "git is not installed...aborting.\nRun 'sudo apt-get install git'."; \
exit 1; }

echo "Checking if pip is installed"
command -v pip >/dev/null 2>&1 || \
{ echo -e >&2 "pip is not installed...aborting.\nRun 'sudo apt-get install python-pip'."; \
exit 1; }

echo "Initializing submodules..."
git submodule init
git submodule update

echo "Installing powerline..."
pip install --user git+git://github.com/Lokaltog/powerline

echo "Setting up powerline..."
echo -e 'if [ -d "$HOME/.local/bin" ]; then
    PATH="$HOME/.local/bin:$PATH"
fi' >>~/.profile

echo "Configuring fonts..."
wget https://github.com/Lokaltog/powerline/raw/develop/font/PowerlineSymbols.otf
wget https://github.com/Lokaltog/powerline/raw/develop/font/10-powerline-symbols.conf
if [ ! -d "~/.fonts" ]; then
    mkdir -p ~/.fonts/
fi
mv PowerlineSymbols.otf ~/.fonts/
fc-cache -vf ~/.fonts
if [ ! -d "~/.config/fontconfig/conf.d" ]; then
    mkdir -p ~/.config/fontconfig/conf.d/
fi
mv 10-powerline-symbols.conf ~/.config/fontconfig/conf.d/

echo "Adding to bashrc..."
echo -e 'if [ -f /usr/local/lib/python2.7/dist-packages/powerline/bindings/bash/powerline.sh ]; then
    source /usr/local/lib/python2.7/dist-packages/powerline/bindings/bash/powerline.sh
fi' >>~/.bashrc
echo -e 'LANG=en_US.utf8'


echo "Deleting the old files..."
rm ~/.vimrc
rm -rf ~/.vim

echo "Symlinking files..."
ln -s `pwd`/vimrc ~/.vimrc
ln -s `pwd`/vim/ ~/.vim

echo "Updating Submodules..."
git submodule foreach git pull origin master --recurse-submodules

echo "All done."
