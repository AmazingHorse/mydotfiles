Bill Heughan's dotfiles
=======================

Location of all my linux config dotfiles.

Windows too, but without the nice script.

If you'd like to use this for yourself, you will need to:
- fork this
- remove my encrypted keys
- add your own keys, as \*.key
- perform the following shell command:
```bash
openssl cast5-cbc -e -in (YOUR_KEY) -out (YOUR_KEY).cast5
```
- enter a password
- commit the \*.cast5 files generated to your fork

*TODO*

- add eagle script to symlink on install script
- decrypting keys asks for a password per key, can this be changed?
- add symlinking of sublime text settings files

Assumptions
-----------
- python 2.6-2.7 installed

Includes
--------
- vimrc and plugins
- eagle.scr
- ssh and encrypted private keys
- install script
- sublime text settings

Does not include
----------------
- pathogen for vim
- vim with python, you'll have to compile that yourself
