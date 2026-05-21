const savedTheme =
    localStorage.getItem('dkist_theme');

if(savedTheme === 'light'){
    document.body.classList.add('light');
}

document.getElementById('themeToggle').onclick = ()=>{

    document.body.classList.toggle('light');

    localStorage.setItem(
        'dkist_theme',
        document.body.classList.contains('light')
            ? 'light'
            : 'dark'
    );
};