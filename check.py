
with open('multiplayer.js', 'r', encoding='utf-8') as f:
    text = f.read()
import re
text = re.sub(r'//.*', '', text)
text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
open_count = text.count('{')
close_count = text.count('}')
print(f'Open: {open_count}, Close: {close_count}')
open_paren = text.count('(')
close_paren = text.count(')')
print(f'Open (: {open_paren}, Close ): {close_paren}')

