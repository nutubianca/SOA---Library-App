# PowerShell script to insert 20 books into BookAPI

$books = @(
    @{ title = 'To Kill a Mockingbird'; author = 'Harper Lee'; isbn = '9780061120084'; description = 'Classic novel of racism and injustice.'; copies_total = 5 },
    @{ title = '1984'; author = 'George Orwell'; isbn = '9780451524935'; description = 'Dystopian novel about totalitarianism.'; copies_total = 4 },
    @{ title = 'The Great Gatsby'; author = 'F. Scott Fitzgerald'; isbn = '9780743273565'; description = 'Novel of the Jazz Age.'; copies_total = 3 },
    @{ title = 'Pride and Prejudice'; author = 'Jane Austen'; isbn = '9780141439518'; description = 'Classic romance novel.'; copies_total = 6 },
    @{ title = 'The Catcher in the Rye'; author = 'J.D. Salinger'; isbn = '9780316769488'; description = 'Coming-of-age story.'; copies_total = 2 },
    @{ title = 'The Hobbit'; author = 'J.R.R. Tolkien'; isbn = '9780547928227'; description = 'Fantasy adventure.'; copies_total = 7 },
    @{ title = 'Fahrenheit 451'; author = 'Ray Bradbury'; isbn = '9781451673319'; description = 'Dystopian novel about censorship.'; copies_total = 3 },
    @{ title = 'Jane Eyre'; author = 'Charlotte Brontë'; isbn = '9780142437209'; description = 'Gothic romance.'; copies_total = 4 },
    @{ title = 'Brave New World'; author = 'Aldous Huxley'; isbn = '9780060850524'; description = 'Dystopian future society.'; copies_total = 5 },
    @{ title = 'Moby-Dick'; author = 'Herman Melville'; isbn = '9781503280786'; description = 'Epic sea adventure.'; copies_total = 2 },
    @{ title = 'The Lord of the Rings'; author = 'J.R.R. Tolkien'; isbn = '9780618640157'; description = 'Epic fantasy trilogy.'; copies_total = 8 },
    @{ title = 'Animal Farm'; author = 'George Orwell'; isbn = '9780451526342'; description = 'Political allegory.'; copies_total = 4 },
    @{ title = 'Wuthering Heights'; author = 'Emily Brontë'; isbn = '9780141439556'; description = 'Classic gothic novel.'; copies_total = 3 },
    @{ title = 'The Odyssey'; author = 'Homer'; isbn = '9780140268867'; description = 'Ancient Greek epic poem.'; copies_total = 5 },
    @{ title = 'Crime and Punishment'; author = 'Fyodor Dostoevsky'; isbn = '9780143058144'; description = 'Psychological drama.'; copies_total = 2 },
    @{ title = 'The Brothers Karamazov'; author = 'Fyodor Dostoevsky'; isbn = '9780374528379'; description = 'Philosophical novel.'; copies_total = 3 },
    @{ title = 'War and Peace'; author = 'Leo Tolstoy'; isbn = '9780199232765'; description = 'Epic Russian novel.'; copies_total = 2 },
    @{ title = 'The Divine Comedy'; author = 'Dante Alighieri'; isbn = '9780142437223'; description = 'Medieval Italian epic poem.'; copies_total = 3 },
    @{ title = 'Great Expectations'; author = 'Charles Dickens'; isbn = '9780141439563'; description = 'Victorian coming-of-age.'; copies_total = 4 },
    @{ title = 'Don Quixote'; author = 'Miguel de Cervantes'; isbn = '9780060934347'; description = 'Classic Spanish novel.'; copies_total = 2 }
)

foreach ($book in $books) {
    $json = $book | ConvertTo-Json
    $response = Invoke-RestMethod -Uri 'http://localhost:3001/books' -Method Post -Body $json -ContentType 'application/json'
    Write-Host "Inserted: $($book.title) by $($book.author) - ID: $($response.id)"
}
