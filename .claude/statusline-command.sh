#!/bin/sh
input=$(cat)

vim_mode=$(echo "$input" | jq -r '.vim.mode // empty')
effort=$(echo "$input" | jq -r '.effort.level // empty')
model=$(echo "$input" | jq -r '.model.display_name // empty')
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')

used=$(echo "$input" | jq -r '
  (.context_window.current_usage // {}) as $u
  | (($u.input_tokens // 0) + ($u.cache_read_input_tokens // 0) + ($u.cache_creation_input_tokens // 0))
')
pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | awk '{printf "%.0f", $1}')

used_k=$(echo "$used" | awk '{
  if($1 < 10000) printf "%.1f", $1/1000
  else printf "%.0f", $1/1000
}')

bar=$(echo "$used" | awk '{
  n=20
  scale=200000
  filled=int($1/scale*n)
  if(filled>n) filled=n
  s=""
  for(i=0;i<n;i++) {
    pos=(i+0.5)/n*scale
    if(pos<100000) c="38;5;78"
    else if(pos<150000) c="38;5;214"
    else c="38;5;167"
    ch = (i<filled) ? "█" : "░"
    s = s "\033[" c "m" ch "\033[0m"
  }
  print s
}')

added_lines=0
removed_lines=0
if [ -n "$cwd" ]; then
  numstat=$(git -C "$cwd" diff --numstat 2>/dev/null)
  added_lines=$(echo "$numstat" | awk '{a+=$1} END {print a+0}')
  removed_lines=$(echo "$numstat" | awk '{r+=$2} END {print r+0}')
fi

case "$effort" in
  low)    effort_color="90" ;;
  medium) effort_color="34" ;;
  high)   effort_color="33" ;;
  xhigh)  effort_color="35" ;;
  max)    effort_color="1;35" ;;
  *)      effort_color="" ;;
esac

parts=""
[ -n "$vim_mode" ] && parts="$vim_mode"
[ -n "$model" ] && parts=$(printf "%s\033[38;5;111m%s\033[0m" "${parts:+$parts }" "$model")
[ -n "$effort" ] && parts=$(printf "%s\033[%sm%s\033[0m" "${parts:+$parts }" "$effort_color" "$effort")

git_part=""
if [ "$added_lines" -gt 0 ] || [ "$removed_lines" -gt 0 ]; then
  git_part=$(printf "\033[38;5;114m+%d\033[0m\033[31m-%d\033[0m" "$added_lines" "$removed_lines")
fi

printf "%s" "$parts"
[ -n "$git_part" ] && printf " %b" "$git_part"
printf " %sK %s %s%%" "$used_k" "$bar" "$pct"
