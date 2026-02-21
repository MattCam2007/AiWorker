# ~/.bashrc: shell prompt and color configuration

# If not running interactively, don't do anything
case $- in
    *i*) ;;
      *) return;;
esac

# set variable identifying the chroot you work in (used in the prompt below)
if [ -z "${debian_chroot:-}" ] && [ -r /etc/debian_chroot ]; then
    debian_chroot=$(cat /etc/debian_chroot)
fi

# Xterm title prefix (user@host:dir in window title bar)
_td_title=''
case "$TERM" in
xterm*|rxvt*)
    _td_title='\[\e]0;'"${debian_chroot:+($debian_chroot)}"'\u@\h: \w\a\]'
    ;;
esac

# Build PS1 inside PROMPT_COMMAND so git branch info uses standard
# \[...\] escaping (which only works in PS1, NOT in $(command substitution)).
# This guarantees readline calculates prompt width correctly — fixing Tab completion.
_td_set_prompt() {
  local git_info=""
  if git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    local branch
    branch=$(git symbolic-ref --short HEAD 2>/dev/null || git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD 2>/dev/null)
    if [[ -n $branch ]]; then
      local color="34"  # blue
      if [[ -n $(git status --porcelain 2>/dev/null) ]]; then
        color="31"  # red
      fi
      git_info="\[\e[${color}m\](${branch})\[\e[0m\] "
    fi
  fi

  PS1="${_td_title}\[\e[36m\]\u\[\e[37m\]@\[\e[32m\]\h\[\e[0m\]: \[\e[36m\]\w\[\e[0m\] ${git_info}\[\e[33m\]%\[\e[0m\] "
}
PROMPT_COMMAND='_td_set_prompt'

# enable color support of ls and also add handy aliases
if [ -x /usr/bin/dircolors ]; then
    test -r ~/.dircolors && eval "$(dircolors -b ~/.dircolors)" || eval "$(dircolors -b)"
    alias ls='ls --color=auto'
    alias grep='grep --color=auto'
    alias fgrep='fgrep --color=auto'
    alias egrep='egrep --color=auto'
fi

alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'

# Enable programmable completion
if ! shopt -oq posix; then
  if [ -f /usr/share/bash-completion/bash_completion ]; then
    . /usr/share/bash-completion/bash_completion
  elif [ -f /etc/bash_completion ]; then
    . /etc/bash_completion
  fi
fi

# Claude Code CLI
export PATH="${HOME}/.local/bin:$PATH"
